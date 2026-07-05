using System.Drawing;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    private const string Title = "SejaElevar";
    private const string BackupReasonBeforeImport = "before_import";
    private const string BackupReasonBeforeEdit = "before_edit";
    private const string BackupReasonBeforeSessionEdit = "before_session_edit";
    private const string BackupReasonImportOriginal = "import_original";
    private const string BackupReasonBeforeRecovery = "before_recovery";
    private const string BackupReasonAfterRecovery = "after_recovery";
    private const string BackupReasonRestored = "restored";
    private const string GlobalCheckpointFolderName = "checkpoints";
    private const int MaxGlobalCheckpoints = 3;
    private const double DefaultZoomFactor = 1.1;
    private static readonly int PreferredPort = GetIntEnvironment("SEJAELEVAR_PORT", 3838);
    private static readonly TimeSpan HeartbeatTimeout = TimeSpan.FromMilliseconds(
        GetIntEnvironment("SEJAELEVAR_IDLE_TIMEOUT_MS", 5000)
    );
    private static readonly JsonSerializerOptions PrettyUtf8JsonOptions = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
    private static readonly JsonSerializerOptions RequestJsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };
    private static readonly object HeartbeatLock = new();
    private static DateTime _lastHeartbeatAt = DateTime.UtcNow;
    private static string? _logPath;
    private static TcpListener? _listener;
    private static volatile bool _shutdownRequested;
    private static AppWindow? _mainWindow;
    private static int _isClosingMainWindow;

    [STAThread]
    private static int Main()
    {
        if (TryFocusRunningApp().GetAwaiter().GetResult())
        {
            return 0;
        }

        var appFolder = Path.GetDirectoryName(Environment.ProcessPath)
            ?? AppContext.BaseDirectory;
        _logPath = Path.Combine(appFolder, "SejaElevar.log");
        var htmlPath = Path.Combine(appFolder, "SejaElevar.html");

        if (!File.Exists(htmlPath))
        {
            ShowMessage("Nao foi possivel encontrar SejaElevar.html nesta pasta.", Title);
            return 1;
        }

        Directory.CreateDirectory(GetDadosFolder(appFolder));
        Directory.CreateDirectory(GetDataSystemFolder(appFolder));
        MigrateLegacyPlanilhasFolder(appFolder);
        MigrateRuntimeControlFiles(appFolder);
        StartBaseWorkbookSession(appFolder);
        StartGlobalDataSession(appFolder);
        try
        {
            var (listener, port) = BindListener();
            _listener = listener;
            var startupToken = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var url = $"http://127.0.0.1:{port}/?startup={startupToken}";
            Log($"Listening on {url}");

            if (Environment.GetEnvironmentVariable("SEJAELEVAR_NO_OPEN") != "1")
            {
                ApplicationConfiguration.Initialize();
                _mainWindow = new AppWindow(url, appFolder);
                _ = Task.Run(() => AcceptClientsAsync(listener, appFolder));
                Application.Run(_mainWindow);
                RequestShutdown("app-run-ended");
                return 0;
            }

            return RunProviderOnlyAsync(listener, appFolder).GetAwaiter().GetResult();
        }
        catch (ObjectDisposedException)
        {
            return 0;
        }
        catch (SocketException)
        {
            return 0;
        }
        catch (Exception error)
        {
            Log(error.ToString());
            ShowMessage($"Nao foi possivel abrir o SejaElevar.\n\n{error.Message}", Title);
            return 1;
        }
    }

    private static async Task<int> RunProviderOnlyAsync(TcpListener listener, string appFolder)
    {
        _ = MonitorHeartbeatAsync(listener);

        while (!_shutdownRequested)
        {
            var client = await listener.AcceptTcpClientAsync();
            _ = Task.Run(() => HandleClientAsync(client, appFolder));
        }

        return 0;
    }

    private static async Task AcceptClientsAsync(TcpListener listener, string appFolder)
    {
        while (!_shutdownRequested)
        {
            try
            {
                var client = await listener.AcceptTcpClientAsync();
                _ = Task.Run(() => HandleClientAsync(client, appFolder));
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            catch (SocketException)
            {
                return;
            }
        }
    }

    private static async Task<bool> TryFocusRunningApp()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(40) };
            var response = await client.GetAsync($"http://127.0.0.1:{PreferredPort}/api/app/status");

            if (!response.IsSuccessStatusCode)
            {
                return false;
            }

            var statusJson = await response.Content.ReadAsStringAsync();
            var shouldFocusExistingWindow = true;

            try
            {
                using var status = JsonDocument.Parse(statusJson);

                if (
                    status.RootElement.TryGetProperty("windowAvailable", out var windowAvailable)
                )
                {
                    shouldFocusExistingWindow =
                        windowAvailable.ValueKind == JsonValueKind.True;
                }
            }
            catch
            {
                shouldFocusExistingWindow = true;
            }

            if (!shouldFocusExistingWindow)
            {
                return false;
            }

            await client.PostAsync($"http://127.0.0.1:{PreferredPort}/api/app/focus", null);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static (TcpListener Listener, int Port) BindListener()
    {
        for (var port = PreferredPort; port < PreferredPort + 20; port++)
        {
            try
            {
                var listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                return (listener, port);
            }
            catch (SocketException)
            {
                if (port == PreferredPort + 19)
                {
                    throw;
                }
            }
        }

        throw new InvalidOperationException("Nao foi possivel iniciar a porta local.");
    }

    private static async Task MonitorHeartbeatAsync(TcpListener listener)
    {
        while (true)
        {
            await Task.Delay(TimeSpan.FromSeconds(1));

            DateTime lastHeartbeat;
            lock (HeartbeatLock)
            {
                lastHeartbeat = _lastHeartbeatAt;
            }

            if (DateTime.UtcNow - lastHeartbeat < HeartbeatTimeout)
            {
                continue;
            }

            RequestShutdown("heartbeat-timeout");
            return;
        }
    }

    private static async Task HandleClientAsync(TcpClient client, string appFolder)
    {
        using var _ = client;
        var stream = client.GetStream();
        var request = await ReadRequestAsync(stream);

        if (request is null)
        {
            return;
        }

        try
        {
            if (request.Method == "GET" && request.Path == "/api/app/status")
            {
                MarkHeartbeat();
                await WriteJsonAsync(
                    stream,
                    200,
                    new
                    {
                        localProvider = true,
                        windowAvailable = _mainWindow is not null && !_mainWindow.IsDisposed,
                        releaseRoot = appFolder,
                        workbookPath = FindCurrentWorkbookPath(appFolder)
                    }
                );
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/app/heartbeat")
            {
                MarkHeartbeat();
                await WriteJsonAsync(stream, 200, new { ok = true });
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/dev/freshdev-reset")
            {
                MarkHeartbeat();
                await ConsumeFreshDevResetAsync(stream, appFolder);
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/app/ready")
            {
                MarkHeartbeat();
                RevealMainWindow();
                await WriteJsonAsync(stream, 200, new { ok = true });
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/app/focus")
            {
                MarkHeartbeat();
                FocusMainWindow();
                await WriteJsonAsync(stream, 200, new { ok = true });
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/app/closed")
            {
                await WriteJsonAsync(stream, 200, new { ok = true });
                RequestShutdown("page-closed");
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/app/window-theme")
            {
                MarkHeartbeat();
                ApplyWindowThemeFromRequest(request);
                await WriteJsonAsync(stream, 200, new { ok = true });
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/base-workbook/schema")
            {
                MarkHeartbeat();
                await ServeBaseWorkbookSchemaAsync(stream);
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/base-workbook/file")
            {
                MarkHeartbeat();
                await ServeWorkbookAsync(stream, appFolder, GetBaseWorkbookControlPath(appFolder));
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/base-workbook/export")
            {
                MarkHeartbeat();
                await ExportWorkbookAsync(stream, appFolder, GetBaseWorkbookControlPath(appFolder));
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/ementas/pick")
            {
                MarkHeartbeat();
                await PickEmentaPdfAsync(stream);
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/ementas/store")
            {
                MarkHeartbeat();
                await StoreEmentaPdfAsync(stream, request, appFolder);
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/aprendizes/file")
            {
                MarkHeartbeat();
                await ServeWorkbookAsync(
                    stream,
                    appFolder,
                    GetEffectiveWorkbookControlPath(appFolder, GetWorkbookControlPath(appFolder))
                );
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/turmas/file")
            {
                MarkHeartbeat();
                await ServeWorkbookAsync(
                    stream,
                    appFolder,
                    GetEffectiveWorkbookControlPath(appFolder, GetTurmasWorkbookControlPath(appFolder))
                );
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/aprendizes/export")
            {
                MarkHeartbeat();
                await ExportWorkbookAsync(
                    stream,
                    appFolder,
                    GetEffectiveWorkbookControlPath(appFolder, GetWorkbookControlPath(appFolder))
                );
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/turmas/export")
            {
                MarkHeartbeat();
                await ExportWorkbookAsync(
                    stream,
                    appFolder,
                    GetEffectiveWorkbookControlPath(appFolder, GetTurmasWorkbookControlPath(appFolder))
                );
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/data-index")
            {
                MarkHeartbeat();
                await ServeDataIndexAsync(stream, appFolder);
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/recovery")
            {
                MarkHeartbeat();
                await ServeGlobalRecoveryInfoAsync(stream, appFolder);
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/recovery")
            {
                MarkHeartbeat();
                await RecoverGlobalCheckpointAsync(stream, request, appFolder);
                return;
            }

            const string dataIndexEntityPath = "/api/data-index/entities/";
            if (
                request.Method == "PUT" &&
                request.Path.StartsWith(dataIndexEntityPath, StringComparison.Ordinal)
            )
            {
                MarkHeartbeat();
                await SaveDataIndexEntityAsync(
                    stream,
                    request,
                    appFolder,
                    request.Path[dataIndexEntityPath.Length..]
                );
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/aprendizes/backup")
            {
                MarkHeartbeat();
                await ServeGlobalRecoveryInfoAsync(stream, appFolder);
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/turmas/backup")
            {
                MarkHeartbeat();
                await ServeGlobalRecoveryInfoAsync(stream, appFolder);
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/aprendizes/recover")
            {
                MarkHeartbeat();
                await RecoverGlobalCheckpointAsync(stream, request, appFolder);
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/turmas/recover")
            {
                MarkHeartbeat();
                await RecoverGlobalCheckpointAsync(stream, request, appFolder);
                return;
            }

            if (
                (request.Method == "POST" && request.Path == "/api/aprendizes/import") ||
                (request.Method == "PUT" && request.Path == "/api/aprendizes/file")
            )
            {
                MarkHeartbeat();
                if (request.Method == "POST")
                {
                    await ImportWorkbookAsync(stream, request, appFolder);
                }
                else
                {
                    await SaveEditedWorkbookAsync(
                        stream,
                        request,
                        appFolder,
                        GetEffectiveWorkbookEntityName(
                            appFolder,
                            "Aprendizes",
                            GetWorkbookControlPath(appFolder)
                        ),
                        GetEffectiveWorkbookControlPath(appFolder, GetWorkbookControlPath(appFolder))
                    );
                }

                return;
            }

            if (request.Method == "PUT" && request.Path == "/api/aprendizes/file/system")
            {
                MarkHeartbeat();
                await SaveSystemWorkbookInPlaceAsync(
                    stream,
                    request,
                    appFolder,
                    GetEffectiveWorkbookControlPath(appFolder, GetWorkbookControlPath(appFolder))
                );
                return;
            }

            if (request.Method == "PUT" && request.Path == "/api/aprendizes/values")
            {
                MarkHeartbeat();
                await PatchWorkbookValuesAsync(
                    stream,
                    request,
                    appFolder,
                    GetEffectiveWorkbookEntityName(
                        appFolder,
                        "Aprendizes",
                        GetWorkbookControlPath(appFolder)
                    ),
                    GetEffectiveWorkbookControlPath(appFolder, GetWorkbookControlPath(appFolder)),
                    false
                );
                return;
            }

            if (
                (request.Method == "POST" && request.Path == "/api/turmas/import") ||
                (request.Method == "PUT" && request.Path == "/api/turmas/file")
            )
            {
                MarkHeartbeat();
                if (request.Method == "POST")
                {
                    await ImportWorkbookAsync(
                        stream,
                        request,
                        appFolder,
                        "Turmas",
                        GetTurmasWorkbookControlPath(appFolder),
                        false
                    );
                }
                else
                {
                    await SaveEditedWorkbookAsync(
                        stream,
                        request,
                        appFolder,
                        GetEffectiveWorkbookEntityName(
                            appFolder,
                            "Turmas",
                            GetTurmasWorkbookControlPath(appFolder)
                        ),
                        GetEffectiveWorkbookControlPath(appFolder, GetTurmasWorkbookControlPath(appFolder)),
                        false
                    );
                }

                return;
            }

            if (request.Method == "PUT" && request.Path == "/api/turmas/file/system")
            {
                MarkHeartbeat();
                await SaveSystemWorkbookInPlaceAsync(
                    stream,
                    request,
                    appFolder,
                    GetEffectiveWorkbookControlPath(appFolder, GetTurmasWorkbookControlPath(appFolder))
                );
                return;
            }

            if (request.Method == "PUT" && request.Path == "/api/turmas/values")
            {
                MarkHeartbeat();
                await PatchWorkbookValuesAsync(
                    stream,
                    request,
                    appFolder,
                    GetEffectiveWorkbookEntityName(
                        appFolder,
                        "Turmas",
                        GetTurmasWorkbookControlPath(appFolder)
                    ),
                    GetEffectiveWorkbookControlPath(appFolder, GetTurmasWorkbookControlPath(appFolder)),
                    false
                );
                return;
            }

            if (
                (request.Method == "POST" && request.Path == "/api/base-workbook/import") ||
                (request.Method == "PUT" && request.Path == "/api/base-workbook/file")
            )
            {
                MarkHeartbeat();
                if (request.Method == "POST")
                {
                    await ImportWorkbookAsync(
                        stream,
                        request,
                        appFolder,
                        "DadosElevar",
                        GetBaseWorkbookControlPath(appFolder),
                        false
                    );
                }
                else
                {
                    await SaveEditedWorkbookAsync(
                        stream,
                        request,
                        appFolder,
                        "DadosElevar",
                        GetBaseWorkbookControlPath(appFolder),
                        false
                    );
                }

                return;
            }

            if (request.Method == "PUT" && request.Path == "/api/base-workbook/file/system")
            {
                MarkHeartbeat();
                await SaveSystemWorkbookInPlaceAsync(
                    stream,
                    request,
                    appFolder,
                    GetBaseWorkbookControlPath(appFolder)
                );
                return;
            }

            await ServeStaticAsync(stream, request, appFolder);
        }
        catch
        {
            await WriteJsonAsync(stream, 500, new { error = "Erro interno do SejaElevar." });
        }
    }

    private static async Task<HttpRequest?> ReadRequestAsync(NetworkStream stream)
    {
        var buffer = new byte[8192];
        var received = new List<byte>();
        var headerEnd = -1;

        while (headerEnd < 0)
        {
            var read = await stream.ReadAsync(buffer);

            if (read <= 0)
            {
                return null;
            }

            received.AddRange(buffer.AsSpan(0, read).ToArray());
            headerEnd = FindHeaderEnd(received);

            if (received.Count > 1024 * 1024)
            {
                throw new InvalidOperationException("Cabecalho HTTP muito grande.");
            }
        }

        var headerText = Encoding.UTF8.GetString(received.Take(headerEnd).ToArray());
        var headerLines = headerText.Split("\r\n");
        var requestLine = headerLines[0].Split(' ');

        if (requestLine.Length < 2)
        {
            return null;
        }

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var line in headerLines.Skip(1))
        {
            var separator = line.IndexOf(':');

            if (separator <= 0)
            {
                continue;
            }

            headers[line[..separator].Trim()] = line[(separator + 1)..].Trim();
        }

        var contentLength = headers.TryGetValue("Content-Length", out var rawLength) &&
            int.TryParse(rawLength, out var length)
                ? length
                : 0;
        var bodyStart = headerEnd + 4;
        var body = received.Skip(bodyStart).ToList();

        while (body.Count < contentLength)
        {
            var read = await stream.ReadAsync(buffer);

            if (read <= 0)
            {
                break;
            }

            body.AddRange(buffer.AsSpan(0, read).ToArray());
        }

        var path = requestLine[1].Split('?')[0];

        return new HttpRequest(
            requestLine[0],
            Uri.UnescapeDataString(path),
            headers,
            body.Take(contentLength).ToArray()
        );
    }

    private static int FindHeaderEnd(List<byte> bytes)
    {
        for (var index = 0; index <= bytes.Count - 4; index++)
        {
            if (
                bytes[index] == '\r' &&
                bytes[index + 1] == '\n' &&
                bytes[index + 2] == '\r' &&
                bytes[index + 3] == '\n'
            )
            {
                return index;
            }
        }

        return -1;
    }

    private static void MarkHeartbeat()
    {
        lock (HeartbeatLock)
        {
            _lastHeartbeatAt = DateTime.UtcNow;
        }
    }

    private static void RequestShutdown(string reason = "requested")
    {
        Log($"Shutdown requested: {reason}");

        lock (HeartbeatLock)
        {
            _lastHeartbeatAt = DateTime.MinValue;
        }

        _shutdownRequested = true;

        try
        {
            _listener?.Stop();
        }
        catch
        {
            // Shutdown should stay quiet if the listener has already stopped.
        }

        CloseMainWindow();
    }

    private static void FocusMainWindow()
    {
        var window = _mainWindow;

        if (window is null || window.IsDisposed)
        {
            return;
        }

        try
        {
            window.BeginInvoke(() =>
            {
                if (window.WindowState == FormWindowState.Minimized)
                {
                    window.WindowState = FormWindowState.Normal;
                }

                window.Show();
                window.Activate();
                window.TopMost = true;
                window.TopMost = false;
            });
        }
        catch
        {
            // Focusing is a convenience; startup should not fail if it is denied.
        }
    }

    private static void RevealMainWindow()
    {
        var window = _mainWindow;

        if (window is null || window.IsDisposed)
        {
            return;
        }

        try
        {
            window.RevealWebView();
        }
        catch
        {
            // Startup reveal is visual only; the app should keep running.
        }
    }

    private static void CloseMainWindow()
    {
        if (Interlocked.Exchange(ref _isClosingMainWindow, 1) == 1)
        {
            return;
        }

        var window = _mainWindow;

        if (window is null || window.IsDisposed)
        {
            return;
        }

        try
        {
            window.BeginInvoke(() =>
            {
                if (!window.IsDisposed)
                {
                    window.Close();
                }
            });
        }
        catch
        {
            // The UI may already be gone during process shutdown.
        }
    }

    private static void ApplyWindowThemeFromRequest(HttpRequest request)
    {
        try
        {
            using var document = JsonDocument.Parse(request.Body);
            var darkMode = document.RootElement.TryGetProperty("darkMode", out var value) &&
                value.ValueKind == JsonValueKind.True;
            var backgroundColor = GetJsonString(document.RootElement, "backgroundColor");
            var titleBarColor = GetJsonString(document.RootElement, "titleBarColor");
            var titleTextColor = GetJsonString(document.RootElement, "titleTextColor");

            ApplyWindowTheme(darkMode, titleBarColor, titleTextColor);
            SaveWindowThemeSettings(darkMode, backgroundColor, titleBarColor, titleTextColor);
        }
        catch
        {
            // Window chrome color is cosmetic and should never interrupt the app.
        }
    }

    private static void SaveWindowThemeSettings(
        bool darkMode,
        string? backgroundColor,
        string? titleBarColor,
        string? titleTextColor
    )
    {
        var window = _mainWindow;

        if (window is null || window.IsDisposed)
        {
            return;
        }

        try
        {
            window.SaveWindowThemeSettings(
                darkMode,
                backgroundColor,
                titleBarColor,
                titleTextColor
            );
        }
        catch
        {
            // Startup color persistence should never interrupt the app.
        }
    }

    private static void ApplyWindowTheme(bool darkMode, string? titleBarColor, string? titleTextColor)
    {
        var window = _mainWindow;

        if (window is null || window.IsDisposed)
        {
            return;
        }

        try
        {
            window.BeginInvoke(() =>
                window.SetTitleBarTheme(darkMode, titleBarColor, titleTextColor)
            );
        }
        catch
        {
            // The UI may already be closing.
        }
    }

    private static string? GetJsonString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var value) &&
            value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
    }

    private static async Task ServeWorkbookAsync(
        NetworkStream stream,
        string appFolder,
        string? controlPath = null
    )
    {
        var control = LoadWorkbookControl(appFolder, controlPath);
        var workbookPath = ResolveWorkbookPath(appFolder, control.OnUseFile);

        if (workbookPath is null || !File.Exists(workbookPath))
        {
            await WriteJsonAsync(stream, 404, new { error = "Planilha nao importada." });
            return;
        }

        var fileName = Path.GetFileName(workbookPath);
        var bytes = await File.ReadAllBytesAsync(workbookPath);
        await WriteResponseAsync(
            stream,
            200,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            bytes,
            new Dictionary<string, string>
            {
                ["cache-control"] = "no-store",
                ["content-disposition"] = $"inline; filename=\"{fileName}\"",
                ["x-file-name"] = Uri.EscapeDataString(fileName)
            }
        );
    }

    private static async Task ExportWorkbookAsync(
        NetworkStream stream,
        string appFolder,
        string? controlPath = null
    )
    {
        var control = LoadWorkbookControl(appFolder, controlPath);
        var workbookPath = ResolveWorkbookPath(appFolder, control.OnUseFile);

        if (workbookPath is null || !File.Exists(workbookPath))
        {
            await WriteJsonAsync(stream, 404, new { error = "Planilha nao importada." });
            return;
        }

        var exportPath = await PickWorkbookExportPathAsync(Path.GetFileName(workbookPath));

        if (string.IsNullOrWhiteSpace(exportPath))
        {
            await WriteJsonAsync(stream, 200, new { canceled = true });
            return;
        }

        try
        {
            File.Copy(workbookPath, exportPath, true);
            await WriteJsonAsync(
                stream,
                200,
                new
                {
                    ok = true,
                    fileName = Path.GetFileName(exportPath),
                    path = exportPath
                }
            );
        }
        catch
        {
            await WriteJsonAsync(stream, 500, new { error = "Nao foi possivel exportar a planilha." });
        }
    }

    private static Task<string?> PickWorkbookExportPathAsync(string defaultFileName)
    {
        var window = _mainWindow;

        if (window is null || window.IsDisposed)
        {
            return Task.FromResult<string?>(null);
        }

        var completion = new TaskCompletionSource<string?>();

        try
        {
            window.BeginInvoke(() =>
            {
                try
                {
                    completion.SetResult(window.PickWorkbookExportPath(defaultFileName));
                }
                catch
                {
                    completion.SetResult(null);
                }
            });
        }
        catch
        {
            completion.SetResult(null);
        }

        return completion.Task;
    }

    private static Task<string?> PickEmentaPdfPathAsync()
    {
        var window = _mainWindow;

        if (window is null || window.IsDisposed)
        {
            return Task.FromResult<string?>(null);
        }

        var completion = new TaskCompletionSource<string?>();

        try
        {
            window.BeginInvoke(() =>
            {
                try
                {
                    completion.SetResult(window.PickEmentaPdfPath());
                }
                catch
                {
                    completion.SetResult(null);
                }
            });
        }
        catch
        {
            completion.SetResult(null);
        }

        return completion.Task;
    }

    private static async Task PickEmentaPdfAsync(NetworkStream stream)
    {
        var pdfPath = await PickEmentaPdfPathAsync();

        if (string.IsNullOrWhiteSpace(pdfPath))
        {
            await WriteJsonAsync(stream, 200, new { canceled = true });
            return;
        }

        if (!File.Exists(pdfPath) || !pdfPath.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
        {
            await WriteJsonAsync(stream, 400, new { error = "Arquivo invalido." });
            return;
        }

        await WriteResponseAsync(
            stream,
            200,
            "application/pdf",
            await File.ReadAllBytesAsync(pdfPath),
            new Dictionary<string, string>
            {
                ["cache-control"] = "no-store",
                ["x-file-name"] = Uri.EscapeDataString(Path.GetFileName(pdfPath))
            }
        );
    }

    private static async Task StoreEmentaPdfAsync(
        NetworkStream stream,
        HttpRequest request,
        string appFolder
    )
    {
        if (request.Body.Length == 0)
        {
            await WriteJsonAsync(stream, 400, new { error = "Arquivo vazio." });
            return;
        }

        var originalFileName = DecodeHeaderValue(request.Headers, "x-file-name") ?? "ementa.pdf";
        var arcoName = DecodeHeaderValue(request.Headers, "x-arco-name") ?? "";
        var ementaId = DecodeHeaderValue(request.Headers, "x-ementa-id");
        var parser = DecodeHeaderValue(request.Headers, "x-parser") ?? "ementa-elevar-v1";

        if (string.IsNullOrWhiteSpace(ementaId) || !IsSafeEntityId(ementaId))
        {
            ementaId = CreateStableEmentaId(arcoName, request.Body);
        }

        var ementasFolder = GetEmentasFolder(appFolder);
        Directory.CreateDirectory(ementasFolder);
        var storedFileName = $"{ementaId}.pdf";
        var targetPath = Path.Combine(ementasFolder, storedFileName);

        await File.WriteAllBytesAsync(targetPath, request.Body);
        UpdateEmentasIndex(
            appFolder,
            ementaId,
            originalFileName,
            storedFileName,
            arcoName,
            parser,
            request.Body
        );

        await WriteJsonAsync(
            stream,
            200,
            new
            {
                ok = true,
                id = ementaId,
                fileName = storedFileName,
                originalFileName,
                arco = arcoName
            }
        );
    }

    private static async Task ImportWorkbookAsync(
        NetworkStream stream,
        HttpRequest request,
        string appFolder,
        string entityName = "Aprendizes",
        string? controlPath = null,
        bool deleteLegacyMetadata = true
    )
    {
        if (request.Body.Length == 0)
        {
            await WriteJsonAsync(stream, 400, new { error = "Arquivo vazio." });
            return;
        }

        var dadosFolder = GetDadosFolder(appFolder);
        Directory.CreateDirectory(dadosFolder);
        var control = LoadWorkbookControl(appFolder, controlPath, controlPath is null);
        var previousOnUsePath = ResolveWorkbookPath(appFolder, control.OnUseFile);
        var previousBackupPath = ResolveWorkbookPath(appFolder, control.BackupFile);
        var importedFileName = GetUniqueTimestampedWorkbookName(dadosFolder, entityName);
        var targetPath = Path.Combine(dadosFolder, importedFileName);

        if (deleteLegacyMetadata)
        {
            DeleteLegacyMetadata(appFolder);
        }

        var importUndoCheckpointId = CaptureGlobalCheckpoint(
            appFolder,
            BackupReasonBeforeImport,
            true
        );

        await File.WriteAllBytesAsync(targetPath, request.Body);

        if (
            previousBackupPath is not null &&
            !string.Equals(previousBackupPath, previousOnUsePath, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(previousBackupPath, targetPath, StringComparison.OrdinalIgnoreCase) &&
            File.Exists(previousBackupPath)
        )
        {
            File.Delete(previousBackupPath);
        }

        var nextControl = new WorkbookControl
        {
            OnUseFile = importedFileName,
            BackupFile = null,
            BackupReason = null,
            RecoveryEnabled = false,
            HasEditingHistory = false,
            CaptureBackupOnNextSave = false
        };

        SaveWorkbookControl(appFolder, nextControl, controlPath);
        CleanupInactiveRootWorkbookFiles(appFolder);

        MarkGlobalCheckpointImported(appFolder);

        await WriteJsonAsync(
            stream,
            200,
            new
            {
                ok = true,
                fileName = importedFileName,
                onUseFile = nextControl.OnUseFile,
                backupFile = nextControl.BackupFile,
                globalCheckpointId = importUndoCheckpointId
            }
        );
    }

    private static async Task ServeTurmasWorkbookAsync(NetworkStream stream, string appFolder)
    {
        var control = LoadTurmasWorkbookControl(appFolder);
        var workbookPath = ResolveWorkbookPath(appFolder, control.OnUseFile);

        if (workbookPath is null || !File.Exists(workbookPath))
        {
            await WriteJsonAsync(stream, 404, new { error = "Planilha nao importada." });
            return;
        }

        var fileName = Path.GetFileName(workbookPath);
        var bytes = await File.ReadAllBytesAsync(workbookPath);
        await WriteResponseAsync(
            stream,
            200,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            bytes,
            new Dictionary<string, string>
            {
                ["cache-control"] = "no-store",
                ["content-disposition"] = $"inline; filename=\"{fileName}\"",
                ["x-file-name"] = Uri.EscapeDataString(fileName)
            }
        );
    }

    private static async Task ImportTurmasWorkbookAsync(
        NetworkStream stream,
        HttpRequest request,
        string appFolder
    )
    {
        if (request.Body.Length == 0)
        {
            await WriteJsonAsync(stream, 400, new { error = "Arquivo vazio." });
            return;
        }

        var dadosFolder = GetDadosFolder(appFolder);
        Directory.CreateDirectory(dadosFolder);
        var currentMeta = LoadSimpleWorkbookMeta(GetTurmasMetaPath(appFolder));
        var currentPath = ResolveWorkbookPath(appFolder, currentMeta.OnUseFile);
        var importedFileName = GetUniqueTimestampedWorkbookName(dadosFolder, "Turmas");
        var targetPath = Path.Combine(dadosFolder, importedFileName);

        await File.WriteAllBytesAsync(targetPath, request.Body);

        if (
            currentPath is not null &&
            !string.Equals(currentPath, targetPath, StringComparison.OrdinalIgnoreCase) &&
            File.Exists(currentPath)
        )
        {
            File.Delete(currentPath);
        }

        var nextMeta = new SimpleWorkbookMeta
        {
            OnUseFile = importedFileName
        };

        SaveSimpleWorkbookMeta(GetTurmasMetaPath(appFolder), nextMeta);

        await WriteJsonAsync(
            stream,
            200,
            new
            {
                ok = true,
                fileName = nextMeta.OnUseFile,
                onUseFile = nextMeta.OnUseFile
            }
        );
    }

    private static async Task SaveEditedWorkbookAsync(
        NetworkStream stream,
        HttpRequest request,
        string appFolder,
        string entityName = "Aprendizes",
        string? controlPath = null,
        bool deleteLegacyMetadata = true
    )
    {
        if (request.Body.Length == 0)
        {
            await WriteJsonAsync(stream, 400, new { error = "Arquivo vazio." });
            return;
        }

        var dadosFolder = GetDadosFolder(appFolder);
        Directory.CreateDirectory(dadosFolder);
        var control = LoadWorkbookControl(appFolder, controlPath, controlPath is null);
        var onUsePath = ResolveWorkbookPath(appFolder, control.OnUseFile);
        var backupPath = ResolveWorkbookPath(appFolder, control.BackupFile);
        var shouldCaptureMissingBackup = backupPath is null &&
            onUsePath is not null &&
            File.Exists(onUsePath);
        var shouldCaptureSessionStart = control.CaptureBackupOnNextSave == true &&
            onUsePath is not null &&
            File.Exists(onUsePath);
        var shouldPreserveOnUseAsBackup = shouldCaptureMissingBackup ||
            shouldCaptureSessionStart;
        var targetFileName = GetUniqueTimestampedWorkbookName(dadosFolder, entityName);
        var targetPath = Path.Combine(dadosFolder, targetFileName);

        CaptureGlobalCheckpointBeforeEdit(appFolder);

        if (
            shouldCaptureSessionStart &&
            backupPath is not null &&
            !string.Equals(backupPath, onUsePath, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(backupPath, targetPath, StringComparison.OrdinalIgnoreCase) &&
            File.Exists(backupPath)
        )
        {
            File.Delete(backupPath);
        }

        await File.WriteAllBytesAsync(targetPath, request.Body);

        if (
            !shouldPreserveOnUseAsBackup &&
            onUsePath is not null &&
            !string.Equals(onUsePath, targetPath, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(onUsePath, backupPath, StringComparison.OrdinalIgnoreCase) &&
            File.Exists(onUsePath)
        )
        {
            File.Delete(onUsePath);
        }

        var nextControl = new WorkbookControl
        {
            OnUseFile = targetFileName,
            BackupFile = null,
            BackupReason = null,
            RecoveryEnabled = false,
            HasEditingHistory = false,
            CaptureBackupOnNextSave = false
        };

        SaveWorkbookControl(appFolder, nextControl, controlPath);
        CleanupInactiveRootWorkbookFiles(appFolder);
        MarkGlobalCheckpointEdited(appFolder);

        if (deleteLegacyMetadata)
        {
            DeleteLegacyMetadata(appFolder);
        }

        await WriteJsonAsync(
            stream,
            200,
            new
            {
                ok = true,
                fileName = targetFileName,
                onUseFile = nextControl.OnUseFile,
                backupFile = nextControl.BackupFile
            }
        );
    }

    private static async Task SaveSystemWorkbookInPlaceAsync(
        NetworkStream stream,
        HttpRequest request,
        string appFolder,
        string? controlPath = null
    )
    {
        if (request.Body.Length == 0)
        {
            await WriteJsonAsync(stream, 400, new { error = "Arquivo vazio." });
            return;
        }

        var control = LoadWorkbookControl(appFolder, controlPath, controlPath is null);
        var onUsePath = ResolveWorkbookPath(appFolder, control.OnUseFile);

        if (onUsePath is null || !File.Exists(onUsePath))
        {
            await WriteJsonAsync(stream, 404, new { error = "Arquivo ativo não encontrado." });
            return;
        }

        await File.WriteAllBytesAsync(onUsePath, request.Body);

        await WriteJsonAsync(
            stream,
            200,
            new
            {
                ok = true,
                fileName = control.OnUseFile,
                onUseFile = control.OnUseFile
            }
        );
    }

    private static async Task PatchWorkbookValuesAsync(
        NetworkStream stream,
        HttpRequest request,
        string appFolder,
        string entityName,
        string? controlPath = null,
        bool deleteLegacyMetadata = true
    )
    {
        if (request.Body.Length == 0)
        {
            await WriteJsonAsync(stream, 400, new { error = "Valores vazios." });
            return;
        }

        WorkbookValuePatchRequest? patchRequest;

        try
        {
            patchRequest = JsonSerializer.Deserialize<WorkbookValuePatchRequest>(
                request.Body,
                RequestJsonOptions
            );
        }
        catch
        {
            await WriteJsonAsync(stream, 400, new { error = "Valores invalidos." });
            return;
        }

        if (
            patchRequest?.Columns is null ||
            patchRequest.Rows is null ||
            patchRequest.Columns.Count == 0
        )
        {
            await WriteJsonAsync(stream, 400, new { error = "Valores invalidos." });
            return;
        }

        var dadosFolder = GetDadosFolder(appFolder);
        Directory.CreateDirectory(dadosFolder);
        var control = LoadWorkbookControl(appFolder, controlPath, controlPath is null);
        var onUsePath = ResolveWorkbookPath(appFolder, control.OnUseFile);

        if (onUsePath is null || !File.Exists(onUsePath))
        {
            await WriteJsonAsync(stream, 404, new { error = "Planilha nao importada." });
            return;
        }

        var backupPath = ResolveWorkbookPath(appFolder, control.BackupFile);
        var shouldCaptureMissingBackup = backupPath is null;
        var shouldCaptureSessionStart = control.CaptureBackupOnNextSave == true;
        var shouldPreserveOnUseAsBackup = shouldCaptureMissingBackup ||
            shouldCaptureSessionStart;
        var targetFileName = GetUniqueTimestampedWorkbookName(dadosFolder, entityName);
        var targetPath = Path.Combine(dadosFolder, targetFileName);
        bool didChange;


        try
        {
            File.Copy(onUsePath, targetPath, true);
            didChange = WorkbookValuePatcher.Patch(targetPath, patchRequest);
        }
        catch
        {
            if (File.Exists(targetPath))
            {
                File.Delete(targetPath);
            }

            await WriteJsonAsync(stream, 500, new { error = "Nao foi possivel gravar a planilha." });
            return;
        }

        if (!didChange)
        {
            if (File.Exists(targetPath))
            {
                File.Delete(targetPath);
            }

            await WriteJsonAsync(
                stream,
                200,
                new
                {
                    ok = true,
                    noChange = true,
                    fileName = control.OnUseFile,
                    onUseFile = control.OnUseFile,
                    backupFile = control.BackupFile
                }
            );
            return;
        }

        CaptureGlobalCheckpointBeforeEdit(appFolder);

        if (
            shouldCaptureSessionStart &&
            backupPath is not null &&
            !string.Equals(backupPath, onUsePath, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(backupPath, targetPath, StringComparison.OrdinalIgnoreCase) &&
            File.Exists(backupPath)
        )
        {
            File.Delete(backupPath);
        }

        if (
            !shouldPreserveOnUseAsBackup &&
            !string.Equals(onUsePath, targetPath, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(onUsePath, backupPath, StringComparison.OrdinalIgnoreCase) &&
            File.Exists(onUsePath)
        )
        {
            File.Delete(onUsePath);
        }

        var nextControl = new WorkbookControl
        {
            OnUseFile = targetFileName,
            BackupFile = null,
            BackupReason = null,
            RecoveryEnabled = false,
            HasEditingHistory = false,
            CaptureBackupOnNextSave = false
        };

        SaveWorkbookControl(appFolder, nextControl, controlPath);
        CleanupInactiveRootWorkbookFiles(appFolder);
        MarkGlobalCheckpointEdited(appFolder);

        if (deleteLegacyMetadata)
        {
            DeleteLegacyMetadata(appFolder);
        }

        await WriteJsonAsync(
            stream,
            200,
            new
            {
                ok = true,
                fileName = targetFileName,
                onUseFile = nextControl.OnUseFile,
                backupFile = nextControl.BackupFile
            }
        );
    }

    private static async Task ServeBackupInfoAsync(
        NetworkStream stream,
        string appFolder,
        string label = "Aprendizes",
        string? controlPath = null
    )
    {
        var control = LoadWorkbookControl(appFolder, controlPath, controlPath is null);
        var backupPath = ResolveWorkbookPath(appFolder, control.BackupFile);
        var reason = NormalizeBackupReason(control.BackupReason);
        var canRecover = backupPath is not null &&
            File.Exists(backupPath) &&
            control.RecoveryEnabled == true;

        await WriteJsonAsync(
            stream,
            200,
            new
            {
                available = backupPath is not null && File.Exists(backupPath),
                canRecover,
                fileName = backupPath is null ? null : Path.GetFileName(backupPath),
                label,
                updatedAt = backupPath is null
                    ? null
                    : File.GetLastWriteTime(backupPath).ToString("O"),
                formattedUpdatedAt = backupPath is null
                    ? null
                    : FormatBackupDateTime(File.GetLastWriteTime(backupPath)),
                reason
            }
        );
    }

    private static async Task RecoverWorkbookBackupAsync(
        NetworkStream stream,
        string appFolder,
        string? controlPath = null,
        bool deleteLegacyMetadata = true
    )
    {
        var dadosFolder = GetDadosFolder(appFolder);
        Directory.CreateDirectory(dadosFolder);

        var control = LoadWorkbookControl(appFolder, controlPath, controlPath is null);
        var backupPath = ResolveWorkbookPath(appFolder, control.BackupFile);
        var onUsePath = ResolveWorkbookPath(appFolder, control.OnUseFile);

        if (
            backupPath is null ||
            !File.Exists(backupPath) ||
            onUsePath is null ||
            !File.Exists(onUsePath) ||
            string.Equals(backupPath, onUsePath, StringComparison.OrdinalIgnoreCase) ||
            control.RecoveryEnabled != true
        )
        {
            await WriteJsonAsync(stream, 400, new { error = "Nenhum backup disponivel." });
            return;
        }

        var nextControl = new WorkbookControl
        {
            OnUseFile = Path.GetFileName(backupPath),
            BackupFile = Path.GetFileName(onUsePath),
            BackupReason = BackupReasonBeforeRecovery,
            RecoveryEnabled = true,
            HasEditingHistory = false,
            CaptureBackupOnNextSave = false
        };

        SaveWorkbookControl(appFolder, nextControl, controlPath);

        if (deleteLegacyMetadata)
        {
            DeleteLegacyMetadata(appFolder);
        }

        await WriteJsonAsync(
            stream,
            200,
            new
            {
                ok = true,
                fileName = nextControl.OnUseFile,
                onUseFile = nextControl.OnUseFile,
                backupFile = nextControl.BackupFile
            }
        );
    }

    private static async Task ServeGlobalRecoveryInfoAsync(
        NetworkStream stream,
        string appFolder
    )
    {
        await WriteJsonAsync(stream, 200, BuildGlobalRecoveryInfo(appFolder));
    }

    private static object BuildGlobalRecoveryInfo(string appFolder)
    {
        var control = LoadGlobalCheckpointControl(appFolder);
        var hasActiveWorkbookData = HasActiveWorkbookData(appFolder);
        var checkpoints = (control.Checkpoints ?? [])
            .Select(entry =>
            {
                var checkpointPath = ResolveGlobalCheckpointPath(appFolder, entry.CheckpointId);
                var createdAt = ParseIsoDateTime(entry.CreatedAt);
                var fileCount = CountGlobalCheckpointWorkbookFiles(checkpointPath);
                var canRecover = entry.RecoveryEnabled == true &&
                    (
                        IsRecoverableGlobalCheckpointDifferentFromActive(
                            appFolder,
                            entry,
                            checkpointPath,
                            hasActiveWorkbookData
                        ) ||
                        (entry.IsEmpty == true && hasActiveWorkbookData)
                    );

                return new
                {
                    checkpointId = entry.CheckpointId,
                    canRecover,
                    label = "Dados",
                    updatedAt = entry.CreatedAt,
                    formattedUpdatedAt = createdAt is null
                        ? null
                        : FormatBackupDateTime(createdAt.Value),
                    reason = NormalizeBackupReason(entry.Reason),
                    importCount = entry.ImportCount ?? 0,
                    fileCount
                };
            })
            .ToList();
        var latestCheckpoint = checkpoints.FirstOrDefault();

        return new
        {
            available = checkpoints.Count > 0,
            canRecover = checkpoints.Any(checkpoint => checkpoint.canRecover),
            fileName = (string?)null,
            label = "Dados",
            checkpointId = latestCheckpoint?.checkpointId,
            updatedAt = latestCheckpoint?.updatedAt,
            formattedUpdatedAt = latestCheckpoint?.formattedUpdatedAt,
            reason = latestCheckpoint?.reason,
            importCount = latestCheckpoint?.importCount,
            fileCount = latestCheckpoint?.fileCount,
            checkpoints
        };
    }

    private static async Task RecoverGlobalCheckpointAsync(
        NetworkStream stream,
        HttpRequest request,
        string appFolder
    )
    {
        var control = LoadGlobalCheckpointControl(appFolder);
        var requestedCheckpointId =
            request.Headers.TryGetValue("x-checkpoint-id", out var rawCheckpointId)
                ? rawCheckpointId
                : null;
        var hasRequestedCheckpoint = !string.IsNullOrWhiteSpace(requestedCheckpointId);
        var selectedCheckpoint = hasRequestedCheckpoint
            ? control.Checkpoints?.FirstOrDefault(entry =>
                string.Equals(
                    entry.CheckpointId,
                    requestedCheckpointId,
                    StringComparison.OrdinalIgnoreCase
                )
            )
            : control.Checkpoints?.FirstOrDefault();
        var selectedCheckpointId = selectedCheckpoint?.CheckpointId ??
            (hasRequestedCheckpoint ? requestedCheckpointId : control.CheckpointId);
        var checkpointPath = ResolveGlobalCheckpointPath(appFolder, selectedCheckpointId);
        var isEmptyCheckpoint = selectedCheckpoint?.IsEmpty == true;

        if (
            (!isEmptyCheckpoint && !IsGlobalCheckpointLocationAvailable(checkpointPath)) ||
            (!hasRequestedCheckpoint && control.RecoveryEnabled != true)
        )
        {
            await WriteJsonAsync(stream, 400, new { error = "Nenhum backup disponivel." });
            return;
        }

        var sources = GetWorkbookSources(appFolder);
        var activeSnapshots = GetActiveWorkbookSnapshots(appFolder, sources).ToList();
        var reverseEntry = CreateGlobalCheckpointEntry(
            appFolder,
            BackupReasonBeforeRecovery,
            true,
            activeSnapshots
        );
        var reverseCheckpointPath = ResolveGlobalCheckpointPath(appFolder, reverseEntry.CheckpointId);

        try
        {
            foreach (var source in sources)
            {
                var checkpointFile = isEmptyCheckpoint
                    ? null
                    : ResolveGlobalCheckpointWorkbookFile(checkpointPath, source);
                var currentControl = LoadWorkbookControl(
                    appFolder,
                    source.ControlPath,
                    source.InferKnownWorkbooks
                );
                var currentPath = ResolveWorkbookPath(appFolder, currentControl.OnUseFile);

                if (checkpointFile is null || !File.Exists(checkpointFile))
                {
                    if (currentPath is not null && File.Exists(currentPath))
                    {
                        File.Delete(currentPath);
                    }

                    SaveWorkbookControl(
                        appFolder,
                        new WorkbookControl
                        {
                            OnUseFile = null,
                            BackupFile = null,
                            BackupReason = null,
                            RecoveryEnabled = false,
                            HasEditingHistory = false,
                            CaptureBackupOnNextSave = false
                        },
                        source.ControlPath
                    );
                    continue;
                }

                var restoredFileName = GetUniqueTimestampedWorkbookName(
                    GetDadosFolder(appFolder),
                    source.EntityName
                );
                var restoredPath = Path.Combine(GetDadosFolder(appFolder), restoredFileName);

                File.Copy(checkpointFile, restoredPath, true);

                if (
                    currentPath is not null &&
                    File.Exists(currentPath) &&
                    !activeSnapshots.Any(snapshot =>
                        string.Equals(snapshot.Path, currentPath, StringComparison.OrdinalIgnoreCase)
                    )
                )
                {
                    File.Delete(currentPath);
                }

                SaveWorkbookControl(
                    appFolder,
                    new WorkbookControl
                    {
                        OnUseFile = restoredFileName,
                        BackupFile = null,
                        BackupReason = null,
                        RecoveryEnabled = false,
                        HasEditingHistory = false,
                        CaptureBackupOnNextSave = false
                    },
                    source.ControlPath
                );
            }

            if (
                checkpointPath is not null &&
                !string.Equals(checkpointPath, reverseCheckpointPath, StringComparison.OrdinalIgnoreCase)
            )
            {
                DeleteGlobalCheckpointLocation(checkpointPath);
            }

            var remainingCheckpoints = (control.Checkpoints ?? [])
                .Where(entry =>
                    !string.Equals(
                        entry.CheckpointId,
                        selectedCheckpointId,
                        StringComparison.OrdinalIgnoreCase
                    )
                );

            control.Checkpoints = [
                reverseEntry,
                ..remainingCheckpoints.Take(MaxGlobalCheckpoints - 1)
            ];
            control.HasEditingHistory = false;
            control.CaptureBackupOnNextSave = false;
            control.LastCheckpointAction = "recovery";
            SaveGlobalCheckpointControl(appFolder, control);
            PruneOrphanGlobalCheckpoints(appFolder, control.Checkpoints);
            CleanupInactiveRootWorkbookFiles(appFolder);

            await WriteJsonAsync(
                stream,
                200,
                new
                {
                    ok = true,
                    checkpointId = reverseEntry.CheckpointId,
                    hasWorkbook = HasActiveWorkbookData(appFolder),
                    recoveryInfo = BuildGlobalRecoveryInfo(appFolder)
                }
            );
        }
        catch
        {
            await WriteJsonAsync(stream, 500, new { error = "Nao foi possivel recuperar os dados." });
        }
    }

    private static async Task ServeStaticAsync(
        NetworkStream stream,
        HttpRequest request,
        string appFolder
    )
    {
        var relativePath = request.Path == "/"
            ? "SejaElevar.html"
            : request.Path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        var fullPath = Path.GetFullPath(Path.Combine(appFolder, relativePath));
        var rootPath = Path.GetFullPath(appFolder);

        if (!fullPath.StartsWith(rootPath, StringComparison.OrdinalIgnoreCase))
        {
            await WriteJsonAsync(stream, 403, new { error = "Caminho bloqueado." });
            return;
        }

        if (!File.Exists(fullPath))
        {
            await WriteRedirectAsync(stream, "/");
            return;
        }

        await WriteResponseAsync(
            stream,
            200,
            GetContentType(Path.GetExtension(fullPath)),
            await File.ReadAllBytesAsync(fullPath),
            new Dictionary<string, string> { ["cache-control"] = "no-store" }
        );
    }

    private static Task WriteJsonAsync(NetworkStream stream, int statusCode, object body)
    {
        return WriteResponseAsync(
            stream,
            statusCode,
            "application/json; charset=utf-8",
            Encoding.UTF8.GetBytes(JsonSerializer.Serialize(body, PrettyUtf8JsonOptions)),
            new Dictionary<string, string> { ["cache-control"] = "no-store" }
        );
    }

    private static Task WriteRedirectAsync(NetworkStream stream, string location)
    {
        var headers =
            "HTTP/1.1 302 Found\r\n" +
            $"Location: {location}\r\n" +
            "Content-Length: 0\r\n" +
            "Connection: close\r\n\r\n";
        return stream.WriteAsync(Encoding.ASCII.GetBytes(headers)).AsTask();
    }

    private static Task WriteResponseAsync(
        NetworkStream stream,
        int statusCode,
        string contentType,
        byte[] body,
        Dictionary<string, string>? extraHeaders = null
    )
    {
        var reason = statusCode switch
        {
            200 => "OK",
            302 => "Found",
            400 => "Bad Request",
            403 => "Forbidden",
            404 => "Not Found",
            500 => "Internal Server Error",
            _ => "OK"
        };
        var builder = new StringBuilder();
        builder.Append($"HTTP/1.1 {statusCode} {reason}\r\n");
        builder.Append($"Content-Type: {contentType}\r\n");
        builder.Append($"Content-Length: {body.Length}\r\n");
        builder.Append("Connection: close\r\n");

        if (extraHeaders is not null)
        {
            foreach (var (key, value) in extraHeaders)
            {
                builder.Append($"{key}: {value}\r\n");
            }
        }

        builder.Append("\r\n");

        var header = Encoding.UTF8.GetBytes(builder.ToString());
        return stream.WriteAsync(header.Concat(body).ToArray()).AsTask();
    }

    private static string GetDadosFolder(string appFolder)
    {
        return Path.Combine(appFolder, "dados");
    }

    private static string GetEmentasFolder(string appFolder)
    {
        return Path.Combine(GetDadosFolder(appFolder), "ementas");
    }

    private static string GetAssetsFolder(string appFolder)
    {
        return Path.Combine(appFolder, "assets");
    }

    private static string GetFreshDevResetMarkerPath(string appFolder)
    {
        return Path.Combine(GetAssetsFolder(appFolder), "freshdev-reset.json");
    }

    private static async Task ConsumeFreshDevResetAsync(NetworkStream stream, string appFolder)
    {
        var markerPath = GetFreshDevResetMarkerPath(appFolder);
        var shouldReset = File.Exists(markerPath);

        if (shouldReset)
        {
            try
            {
                File.Delete(markerPath);
            }
            catch
            {
                // The marker is one-shot; if deletion fails, the next launch can try again.
            }
        }

        await WriteJsonAsync(stream, 200, new { ok = true, reset = shouldReset });
    }

    private static string GetWorkbookControlPath(string appFolder)
    {
        return Path.Combine(GetDadosFolder(appFolder), "controle.json");
    }

    private static string GetTurmasMetaPath(string appFolder)
    {
        return Path.Combine(GetDadosFolder(appFolder), "turmas.json");
    }

    private static string GetTurmasWorkbookControlPath(string appFolder)
    {
        return Path.Combine(GetDadosFolder(appFolder), "turmas-controle.json");
    }

    private static string GetBaseWorkbookControlPath(string appFolder)
    {
        return Path.Combine(GetDataSystemFolder(appFolder), "dados-elevar-controle.json");
    }

    private static string GetEffectiveWorkbookControlPath(string appFolder, string requestedControlPath)
    {
        var baseControlPath = GetBaseWorkbookControlPath(appFolder);

        if (string.Equals(requestedControlPath, baseControlPath, StringComparison.OrdinalIgnoreCase))
        {
            return requestedControlPath;
        }

        var baseControl = LoadWorkbookControl(appFolder, baseControlPath, true);
        var baseWorkbookPath = ResolveWorkbookPath(appFolder, baseControl.OnUseFile);

        if (baseWorkbookPath is not null && File.Exists(baseWorkbookPath))
        {
            return baseControlPath;
        }

        return requestedControlPath;
    }

    private static string GetEffectiveWorkbookEntityName(
        string appFolder,
        string requestedEntityName,
        string requestedControlPath
    )
    {
        var effectiveControlPath = GetEffectiveWorkbookControlPath(appFolder, requestedControlPath);

        return string.Equals(
            effectiveControlPath,
            GetBaseWorkbookControlPath(appFolder),
            StringComparison.OrdinalIgnoreCase
        )
            ? "DadosElevar"
            : requestedEntityName;
    }

    private static string GetGlobalCheckpointControlPath(string appFolder)
    {
        return Path.Combine(GetDataSystemFolder(appFolder), "controle-global.json");
    }

    private static string GetGlobalCheckpointsFolder(string appFolder)
    {
        return Path.Combine(GetDadosFolder(appFolder), GlobalCheckpointFolderName);
    }

    private static string GetDataSystemFolder(string appFolder)
    {
        return Path.Combine(GetDadosFolder(appFolder), "sistema");
    }

    private static string GetDataIndexPath(string appFolder)
    {
        return Path.Combine(GetDataSystemFolder(appFolder), "data-index.json");
    }

    private static string GetEmentasIndexPath(string appFolder)
    {
        return Path.Combine(GetDataSystemFolder(appFolder), "ementas-index.json");
    }

    private static void MigrateRuntimeControlFiles(string appFolder)
    {
        var dadosFolder = GetDadosFolder(appFolder);
        var systemFolder = GetDataSystemFolder(appFolder);
        Directory.CreateDirectory(systemFolder);

        MoveRootControlToSystem(
            Path.Combine(dadosFolder, "dados-elevar-controle.json"),
            Path.Combine(systemFolder, "dados-elevar-controle.json")
        );
        MoveRootControlToSystem(
            Path.Combine(dadosFolder, "controle-global.json"),
            Path.Combine(systemFolder, "controle-global.json")
        );

        DeleteEmptyLegacyControlFile(Path.Combine(dadosFolder, "controle.json"));
        DeleteEmptyLegacyControlFile(Path.Combine(dadosFolder, "turmas-controle.json"));
    }

    private static void MoveRootControlToSystem(string rootPath, string systemPath)
    {
        try
        {
            if (!File.Exists(rootPath))
            {
                return;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(systemPath) ?? ".");

            if (!File.Exists(systemPath))
            {
                File.Move(rootPath, systemPath);
                return;
            }

            if (File.GetLastWriteTimeUtc(rootPath) > File.GetLastWriteTimeUtc(systemPath))
            {
                File.Copy(rootPath, systemPath, true);
            }

            File.Delete(rootPath);
        }
        catch
        {
            // A locked or malformed control file can be retried on the next launch.
        }
    }

    private static void DeleteEmptyLegacyControlFile(string controlPath)
    {
        try
        {
            if (!File.Exists(controlPath))
            {
                return;
            }

            var control = JsonSerializer.Deserialize<WorkbookControl>(File.ReadAllText(controlPath));

            if (control is not null && IsEmptyWorkbookControl(control))
            {
                File.Delete(controlPath);
            }
        }
        catch
        {
            // Leave non-readable files alone; they may be user/debug artifacts.
        }
    }

    private static async Task ServeBaseWorkbookSchemaAsync(NetworkStream stream)
    {
        await WriteJsonAsync(
            stream,
            200,
            new
            {
                schemaVersion = 1,
                intendedFileName = "DadosElevar.xlsx",
                activeFileNamePattern = "DadosElevar_HHmmssddMMyy.xlsx",
                currentStorageMode = "multi-workbook-transition",
                sheets = new object[]
                {
                    new
                    {
                        entityId = "aprendizes",
                        sheetName = "Aprendizes",
                        label = "Aprendizes",
                        status = "active-legacy-workbook",
                        legacyApiBasePath = "/api/aprendizes",
                        requiredColumns = new[]
                        {
                            "Nome",
                            "Sexo",
                            "Data de Nascimento",
                            "Idade",
                            "Contato",
                            "E-mail",
                            "RG",
                            "CPF",
                            "Endere\u00e7o",
                            "Institui\u00e7\u00e3o de Ensino",
                            "Respons\u00e1vel",
                            "Contato do Respons\u00e1vel",
                            "E-mail do Respons\u00e1vel",
                            "Data de Admiss\u00e3o",
                            "Data do T\u00e9rmino",
                            "Arco de Aprendizagem",
                            "Fun\u00e7\u00e3o",
                            "Turma",
                            "Empresa"
                        }
                    },
                    new
                    {
                        entityId = "turmas",
                        sheetName = "Turmas",
                        label = "Turmas",
                        status = "active-legacy-workbook",
                        legacyApiBasePath = "/api/turmas",
                        requiredColumns = new[]
                        {
                            "Turma",
                            "Dia",
                            "Per\u00edodo",
                            "Instrutor",
                            "Sala"
                        }
                    },
                    new
                    {
                        entityId = "arcos",
                        sheetName = "Arcos",
                        label = "Arcos",
                        status = "planned-index-ready",
                        legacyApiBasePath = (string?)null,
                        requiredColumns = new[]
                        {
                            "Arco",
                            "Arquivo Ementa",
                            "ID",
                            "Ementa ID"
                        }
                    },
                    new
                    {
                        entityId = "disciplinas",
                        sheetName = "Disciplinas",
                        label = "Disciplinas",
                        status = "planned-index-ready",
                        legacyApiBasePath = (string?)null,
                        requiredColumns = new[]
                        {
                            "Disciplina",
                            "M\u00f3dulo",
                            "Arco",
                            "Carga Hor\u00e1ria",
                            "ID",
                            "Ementa ID"
                        }
                    },
                    new
                    {
                        entityId = "empresas",
                        sheetName = "Empresas",
                        label = "Empresas",
                        status = "planned",
                        legacyApiBasePath = (string?)null,
                        requiredColumns = Array.Empty<string>()
                    },
                    new
                    {
                        entityId = "aulas",
                        sheetName = "Aulas",
                        label = "Aulas",
                        status = "planned-index-ready",
                        legacyApiBasePath = (string?)null,
                        requiredColumns = new[]
                        {
                            "Aula",
                            "Cor",
                            "Instrutor Padr\u00e3o",
                            "Sala Padr\u00e3o",
                            "ID"
                        }
                    },
                    new
                    {
                        entityId = "aulas-disciplinas",
                        sheetName = "Aulas Disciplinas",
                        label = "Aulas Disciplinas",
                        status = "planned-index-ready",
                        legacyApiBasePath = (string?)null,
                        requiredColumns = new[]
                        {
                            "Aula",
                            "Arco",
                            "M\u00f3dulo",
                            "Disciplina",
                            "Aula ID",
                            "Disciplina ID",
                            "ID"
                        }
                    },
                    new
                    {
                        entityId = "cronograma",
                        sheetName = "Cronograma",
                        label = "Cronograma",
                        status = "planned-index-ready",
                        legacyApiBasePath = (string?)null,
                        requiredColumns = new[]
                        {
                            "Turma",
                            "Data",
                            "In\u00edcio",
                            "Fim",
                            "Tipo",
                            "Aula",
                            "Instrutor",
                            "Sala",
                            "Cor",
                            "Aula ID",
                            "ID"
                        }
                    },
                    new
                    {
                        entityId = "presencas",
                        sheetName = "Presencas",
                        label = "Presencas",
                        status = "planned-index-ready",
                        legacyApiBasePath = (string?)null,
                        requiredColumns = new[]
                        {
                            "Aprendiz",
                            "Status Presen\u00e7a",
                            "Turma",
                            "Data",
                            "In\u00edcio",
                            "Fim",
                            "Aula",
                            "Instrutor",
                            "Sala",
                            "Evento ID",
                            "Aula ID",
                            "Aprendiz ID",
                            "Turma ID",
                            "ID"
                        }
                    },
                    new
                    {
                        entityId = "plano-ensino",
                        sheetName = "Plano de Ensino",
                        label = "Plano de Ensino",
                        status = "planned-index-ready",
                        legacyApiBasePath = (string?)null,
                        requiredColumns = new[]
                        {
                            "Aprendiz",
                            "Arco",
                            "M\u00f3dulo",
                            "Disciplina",
                            "Carga Hor\u00e1ria Total",
                            "Aprendiz ID",
                            "Arco ID",
                            "Disciplina ID",
                            "ID"
                        }
                    },
                    new
                    {
                        entityId = "horas-aplicadas",
                        sheetName = "Horas Aplicadas",
                        label = "Horas Aplicadas",
                        status = "planned-index-ready",
                        legacyApiBasePath = (string?)null,
                        requiredColumns = new[]
                        {
                            "Aprendiz",
                            "Arco",
                            "M\u00f3dulo",
                            "Disciplina",
                            "Minutos Aplicados",
                            "Data",
                            "Aula",
                            "Evento ID",
                            "Presen\u00e7a ID",
                            "Aprendiz ID",
                            "Disciplina ID",
                            "Aula ID",
                            "ID"
                        }
                    },
                    new
                    {
                        entityId = "plano-progresso",
                        sheetName = "Plano Progresso",
                        label = "Plano Progresso",
                        status = "planned-index-ready",
                        legacyApiBasePath = (string?)null,
                        requiredColumns = new[]
                        {
                            "Aprendiz",
                            "Arco",
                            "M\u00f3dulo",
                            "Disciplina",
                            "Carga Hor\u00e1ria Total",
                            "Carga Hor\u00e1ria Cumprida",
                            "Excedente",
                            "Aprendiz ID",
                            "Disciplina ID",
                            "ID"
                        }
                    }
                }
            }
        );
    }

    private static async Task ServeDataIndexAsync(NetworkStream stream, string appFolder)
    {
        await WriteJsonAsync(stream, 200, LoadDataIndex(appFolder));
    }

    private static async Task SaveDataIndexEntityAsync(
        NetworkStream stream,
        HttpRequest request,
        string appFolder,
        string entityId
    )
    {
        entityId = entityId.Trim('/');

        if (!IsSafeEntityId(entityId))
        {
            await WriteJsonAsync(stream, 400, new { error = "Entidade invalida." });
            return;
        }

        JsonObject? entity;

        try
        {
            entity = JsonNode.Parse(Encoding.UTF8.GetString(request.Body)) as JsonObject;
        }
        catch
        {
            entity = null;
        }

        if (entity is null)
        {
            await WriteJsonAsync(stream, 400, new { error = "Indice invalido." });
            return;
        }

        var index = LoadDataIndex(appFolder);
        var entities = GetDataIndexEntities(index);
        var now = DateTime.UtcNow.ToString("O");

        entity["entity"] = entityId;
        entity["updatedAt"] ??= now;
        index["schemaVersion"] = 1;
        index["updatedAt"] = now;
        entities[entityId] = entity;

        SaveDataIndex(appFolder, index);
        await WriteJsonAsync(stream, 200, new { ok = true, entity = entityId });
    }

    private static JsonObject LoadDataIndex(string appFolder)
    {
        var indexPath = GetDataIndexPath(appFolder);
        JsonObject? index = null;

        try
        {
            if (File.Exists(indexPath))
            {
                index = JsonNode.Parse(File.ReadAllText(indexPath)) as JsonObject;
            }
        }
        catch
        {
            index = null;
        }

        index ??= new JsonObject();
        index["schemaVersion"] = 1;
        GetDataIndexEntities(index);
        return index;
    }

    private static JsonObject GetDataIndexEntities(JsonObject index)
    {
        if (index["entities"] is JsonObject entities)
        {
            return entities;
        }

        entities = new JsonObject();
        index["entities"] = entities;
        return entities;
    }

    private static void SaveDataIndex(string appFolder, JsonObject index)
    {
        var dataSystemFolder = GetDataSystemFolder(appFolder);
        Directory.CreateDirectory(dataSystemFolder);
        File.WriteAllText(
            GetDataIndexPath(appFolder),
            index.ToJsonString(PrettyUtf8JsonOptions),
            Encoding.UTF8
        );
    }

    private static bool IsSafeEntityId(string entityId)
    {
        return entityId.Length > 0 &&
            entityId.All(character =>
                (character >= 'a' && character <= 'z') ||
                (character >= '0' && character <= '9') ||
                character == '-' ||
                character == '_'
            );
    }

    private static string? DecodeHeaderValue(Dictionary<string, string> headers, string name)
    {
        if (!headers.TryGetValue(name, out var value) || string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        try
        {
            return Uri.UnescapeDataString(value).Trim();
        }
        catch
        {
            return value.Trim();
        }
    }

    private static string CreateStableEmentaId(string arcoName, byte[] body)
    {
        var normalizedName = NormalizeIdentifierText(arcoName);
        var hash = Convert.ToHexString(SHA256.HashData(body)).ToLowerInvariant()[..10];
        return string.IsNullOrWhiteSpace(normalizedName)
            ? $"ementa_{hash}"
            : $"ementa_{normalizedName}_{hash}";
    }

    private static string NormalizeIdentifierText(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder();
        var previousWasSeparator = false;

        foreach (var character in normalized)
        {
            var category = System.Globalization.CharUnicodeInfo.GetUnicodeCategory(character);

            if (category == System.Globalization.UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            var lower = char.ToLowerInvariant(character);
            var isAllowed =
                (lower >= 'a' && lower <= 'z') ||
                (lower >= '0' && lower <= '9');

            if (isAllowed)
            {
                builder.Append(lower);
                previousWasSeparator = false;
                continue;
            }

            if (!previousWasSeparator && builder.Length > 0)
            {
                builder.Append('_');
                previousWasSeparator = true;
            }
        }

        return builder.ToString().Trim('_');
    }

    private static void UpdateEmentasIndex(
        string appFolder,
        string id,
        string originalFileName,
        string storedFileName,
        string arcoName,
        string parser,
        byte[] body
    )
    {
        var indexPath = GetEmentasIndexPath(appFolder);
        JsonObject index;

        try
        {
            index = File.Exists(indexPath)
                ? JsonNode.Parse(File.ReadAllText(indexPath)) as JsonObject ?? new JsonObject()
                : new JsonObject();
        }
        catch
        {
            index = new JsonObject();
        }

        var ementas = index["ementas"] as JsonObject ?? new JsonObject();
        var importedAt = DateTime.UtcNow.ToString("O");

        index["schemaVersion"] = 1;
        index["updatedAt"] = importedAt;
        index["ementas"] = ementas;
        ementas[id] = new JsonObject
        {
            ["id"] = id,
            ["originalFileName"] = originalFileName,
            ["fileName"] = storedFileName,
            ["hash"] = Convert.ToHexString(SHA256.HashData(body)).ToLowerInvariant(),
            ["arco"] = arcoName,
            ["parser"] = parser,
            ["status"] = "parsed",
            ["importedAt"] = importedAt
        };

        Directory.CreateDirectory(Path.GetDirectoryName(indexPath) ?? GetDataSystemFolder(appFolder));
        File.WriteAllText(
            indexPath,
            index.ToJsonString(PrettyUtf8JsonOptions),
            Encoding.UTF8
        );
    }

    private static void StartWorkbookSession(string appFolder, string? controlPath = null)
    {
        var control = LoadWorkbookControl(appFolder, controlPath, controlPath is null);

        if (control.OnUseFile is null)
        {
            return;
        }

        if (control.BackupReason == BackupReasonBeforeEdit)
        {
            control.BackupReason = BackupReasonBeforeSessionEdit;
        }

        control.CaptureBackupOnNextSave = control.HasEditingHistory == true;
        SaveWorkbookControl(appFolder, control, controlPath);
    }

    private static void StartGlobalDataSession(string appFolder)
    {
        var control = LoadGlobalCheckpointControl(appFolder);

        AgeGlobalEditCheckpointsForNewSession(control);

        var shouldKeepFirstImportMarker =
            control.LastCheckpointAction == "import" &&
            control.HasEditingHistory != true &&
            (control.Checkpoints is null || control.Checkpoints.Count == 0);

        if (control.LastCheckpointAction == "import" && !shouldKeepFirstImportMarker)
        {
            control.LastCheckpointAction = null;
        }

        control.CaptureBackupOnNextSave = control.HasEditingHistory == true;

        if (IsEmptyGlobalCheckpointControl(control))
        {
            DeleteFileIfExists(GetGlobalCheckpointControlPath(appFolder));
        }
        else
        {
            SaveGlobalCheckpointControl(appFolder, control);
            PruneOrphanGlobalCheckpoints(appFolder, control.Checkpoints);
        }
    }

    private static void AgeGlobalEditCheckpointsForNewSession(GlobalCheckpointControl control)
    {
        if (control.Reason == BackupReasonBeforeEdit)
        {
            control.Reason = BackupReasonBeforeSessionEdit;
        }

        if (control.Checkpoints is null)
        {
            return;
        }

        foreach (var checkpoint in control.Checkpoints)
        {
            if (NormalizeBackupReason(checkpoint.Reason) == BackupReasonBeforeEdit)
            {
                checkpoint.Reason = BackupReasonBeforeSessionEdit;
            }
        }
    }

    private static void CaptureGlobalCheckpointBeforeEdit(string appFolder)
    {
        var control = LoadGlobalCheckpointControl(appFolder);
        var checkpointPath = ResolveGlobalCheckpointPath(appFolder, control.CheckpointId);
        var checkpointMissing = !IsGlobalCheckpointLocationAvailable(checkpointPath);
        var latestCheckpoint = control.Checkpoints?.FirstOrDefault();
        var shouldCaptureImportedOriginalBeforeFirstEdit =
            control.LastCheckpointAction == "import" &&
            control.HasEditingHistory != true &&
            (
                latestCheckpoint is null ||
                (
                    latestCheckpoint.Reason == BackupReasonBeforeImport &&
                    CountGlobalCheckpointWorkbookFiles(
                        ResolveGlobalCheckpointPath(appFolder, latestCheckpoint.CheckpointId)
                    ) == 0
                )
            );

        if (
            checkpointMissing ||
            control.CaptureBackupOnNextSave == true ||
            shouldCaptureImportedOriginalBeforeFirstEdit
        )
        {
            CaptureGlobalCheckpoint(
                appFolder,
                shouldCaptureImportedOriginalBeforeFirstEdit
                    ? BackupReasonImportOriginal
                    : BackupReasonBeforeEdit,
                true
            );
            return;
        }

        if (control.RecoveryEnabled != true)
        {
            control.RecoveryEnabled = true;
            SaveGlobalCheckpointControl(appFolder, control);
        }
    }

    private static void MarkGlobalCheckpointEdited(string appFolder)
    {
        var control = LoadGlobalCheckpointControl(appFolder);

        if (control.CheckpointId is null)
        {
            return;
        }

        control.RecoveryEnabled = true;
        control.HasEditingHistory = true;
        control.CaptureBackupOnNextSave = false;
        control.LastCheckpointAction = "edit";
        SaveGlobalCheckpointControl(appFolder, control);
    }

    private static void MarkGlobalCheckpointImported(string appFolder)
    {
        var control = LoadGlobalCheckpointControl(appFolder);

        control.RecoveryEnabled = control.CheckpointId is not null;
        control.HasEditingHistory = false;
        control.CaptureBackupOnNextSave = false;
        control.LastCheckpointAction = "import";
        SaveGlobalCheckpointControl(appFolder, control);
    }

    private static string? CaptureGlobalCheckpoint(
        string appFolder,
        string reason,
        bool recoveryEnabled,
        bool allowEmpty = false
    )
    {
        var control = LoadGlobalCheckpointControl(appFolder);
        var normalizedReason = NormalizeBackupReason(reason) ?? reason;
        var latestCheckpoint = control.Checkpoints?.FirstOrDefault();

        if (
            normalizedReason == BackupReasonBeforeImport &&
            control.LastCheckpointAction == "import" &&
            latestCheckpoint is not null &&
            latestCheckpoint.Reason == BackupReasonBeforeImport &&
            (latestCheckpoint.IsEmpty == true ||
                ResolveGlobalCheckpointPath(appFolder, latestCheckpoint.CheckpointId) is not null)
        )
        {
            latestCheckpoint.ImportCount = Math.Max(1, latestCheckpoint.ImportCount ?? 1) + 1;
            SaveGlobalCheckpointControl(appFolder, control);
            return latestCheckpoint.CheckpointId;
        }

        var sources = GetWorkbookSources(appFolder);
        var snapshots = GetActiveWorkbookSnapshots(appFolder, sources).ToList();

        if (snapshots.Count == 0 && !allowEmpty)
        {
            return null;
        }

        var checkpointEntry = CreateGlobalCheckpointEntry(
            appFolder,
            normalizedReason,
            recoveryEnabled,
            snapshots
        );

        control.Checkpoints = [
            checkpointEntry,
            ..(control.Checkpoints ?? [])
                .Where(entry => entry.CheckpointId != checkpointEntry.CheckpointId)
                .Take(MaxGlobalCheckpoints - 1)
        ];
        control.HasEditingHistory = recoveryEnabled;
        control.CaptureBackupOnNextSave = false;
        SaveGlobalCheckpointControl(appFolder, control);
        PruneOrphanGlobalCheckpoints(appFolder, control.Checkpoints);

        return checkpointEntry.CheckpointId;
    }

    private static GlobalCheckpointEntry CreateGlobalCheckpointEntry(
        string appFolder,
        string reason,
        bool recoveryEnabled,
        IReadOnlyList<WorkbookSnapshot> snapshots
    )
    {
        var checkpointsFolder = GetGlobalCheckpointsFolder(appFolder);
        Directory.CreateDirectory(checkpointsFolder);

        var normalizedReason = NormalizeBackupReason(reason) ?? reason;
        string checkpointId;

        if (snapshots.Count == 0)
        {
            checkpointId = CreateEmptyCheckpointId(appFolder);
        }
        else if (snapshots.Count == 1 && snapshots[0].EntityId == "base-workbook")
        {
            checkpointId = GetUniqueTimestampedWorkbookName(checkpointsFolder, "DadosElevar");
            File.Copy(snapshots[0].Path, Path.Combine(checkpointsFolder, checkpointId), true);
        }
        else
        {
            checkpointId = CreateCheckpointId();
            var checkpointPath = Path.Combine(checkpointsFolder, checkpointId);
            Directory.CreateDirectory(checkpointPath);

            foreach (var snapshot in snapshots)
            {
                File.Copy(
                    snapshot.Path,
                    Path.Combine(checkpointPath, snapshot.CheckpointFileName),
                    true
                );
            }

            WriteCheckpointManifest(checkpointPath, normalizedReason, snapshots);
        }

        return new GlobalCheckpointEntry
        {
            CheckpointId = checkpointId,
            Reason = normalizedReason,
            CreatedAt = DateTime.Now.ToString("O"),
            RecoveryEnabled = recoveryEnabled,
            ImportCount = normalizedReason == BackupReasonBeforeImport ? 1 : null,
            IsEmpty = snapshots.Count == 0 ? true : null
        };
    }

    private static void PruneOrphanGlobalCheckpoints(
        string appFolder,
        IEnumerable<GlobalCheckpointEntry>? activeCheckpoints
    )
    {
        var checkpointsFolder = GetGlobalCheckpointsFolder(appFolder);

        if (!Directory.Exists(checkpointsFolder))
        {
            return;
        }

        var activeCheckpointPaths = (activeCheckpoints ?? [])
            .Select(entry => ResolveGlobalCheckpointPath(appFolder, entry.CheckpointId))
            .Where(path => path is not null)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var checkpointPath in Directory.EnumerateDirectories(checkpointsFolder))
        {
            if (activeCheckpointPaths.Contains(checkpointPath))
            {
                continue;
            }

            try
            {
                Directory.Delete(checkpointPath, true);
            }
            catch
            {
                // Old same-session undo checkpoints are best-effort cleanup.
            }
        }

        foreach (var checkpointFile in Directory.EnumerateFiles(checkpointsFolder, "*.xlsx", SearchOption.TopDirectoryOnly))
        {
            if (activeCheckpointPaths.Contains(checkpointFile))
            {
                continue;
            }

            try
            {
                File.Delete(checkpointFile);
            }
            catch
            {
                // Old same-session undo checkpoints are best-effort cleanup.
            }
        }
    }

    private static int CountGlobalCheckpointWorkbookFiles(string? checkpointPath)
    {
        if (checkpointPath is null)
        {
            return 0;
        }

        if (File.Exists(checkpointPath))
        {
            return 1;
        }

        return Directory.Exists(checkpointPath)
            ? Directory
                .EnumerateFiles(checkpointPath, "*.xlsx", SearchOption.TopDirectoryOnly)
                .Count()
            : 0;
    }

    private static bool IsRecoverableGlobalCheckpointDifferentFromActive(
        string appFolder,
        GlobalCheckpointEntry entry,
        string? checkpointPath,
        bool hasActiveWorkbookData
    )
    {
        if (entry.IsEmpty == true)
        {
            return hasActiveWorkbookData;
        }

        if (!IsGlobalCheckpointLocationAvailable(checkpointPath))
        {
            return false;
        }

        if (NormalizeBackupReason(entry.Reason) == BackupReasonBeforeRecovery)
        {
            return hasActiveWorkbookData;
        }

        var sources = GetWorkbookSources(appFolder);
        var activeSnapshots = GetActiveWorkbookSnapshots(appFolder, sources)
            .ToDictionary(snapshot => snapshot.EntityId, StringComparer.OrdinalIgnoreCase);

        foreach (var source in sources)
        {
            var checkpointFile = ResolveGlobalCheckpointWorkbookFile(checkpointPath, source);
            activeSnapshots.TryGetValue(source.EntityId, out var activeSnapshot);

            if (checkpointFile is null || !File.Exists(checkpointFile))
            {
                if (activeSnapshot is not null)
                {
                    return true;
                }

                continue;
            }

            if (activeSnapshot is null || !File.Exists(activeSnapshot.Path))
            {
                return true;
            }

            if (!FilesHaveSameContent(activeSnapshot.Path, checkpointFile))
            {
                return true;
            }
        }

        return false;
    }

    private static bool FilesHaveSameContent(string leftPath, string rightPath)
    {
        var leftInfo = new FileInfo(leftPath);
        var rightInfo = new FileInfo(rightPath);

        if (!leftInfo.Exists || !rightInfo.Exists)
        {
            return false;
        }

        if (leftInfo.Length != rightInfo.Length)
        {
            return false;
        }

        const int BufferSize = 64 * 1024;
        using var leftStream = File.OpenRead(leftPath);
        using var rightStream = File.OpenRead(rightPath);
        var leftBuffer = new byte[BufferSize];
        var rightBuffer = new byte[BufferSize];

        while (true)
        {
            var leftRead = leftStream.Read(leftBuffer, 0, leftBuffer.Length);
            var rightRead = rightStream.Read(rightBuffer, 0, rightBuffer.Length);

            if (leftRead != rightRead)
            {
                return false;
            }

            if (leftRead == 0)
            {
                return true;
            }

            for (var index = 0; index < leftRead; index += 1)
            {
                if (leftBuffer[index] != rightBuffer[index])
                {
                    return false;
                }
            }
        }
    }

    private static void CleanupInactiveRootWorkbookFiles(string appFolder)
    {
        var dadosFolder = GetDadosFolder(appFolder);

        if (!Directory.Exists(dadosFolder))
        {
            return;
        }

        var activeFileNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var source in GetWorkbookSources(appFolder))
        {
            try
            {
                if (!File.Exists(source.ControlPath))
                {
                    continue;
                }

                var control = JsonSerializer.Deserialize<WorkbookControl>(
                    File.ReadAllText(source.ControlPath)
                );
                var onUseFile = NormalizeTrackedWorkbookFileName(control?.OnUseFile);

                if (onUseFile is not null)
                {
                    activeFileNames.Add(onUseFile);
                }
            }
            catch
            {
                // Cleanup should never block saving the user's current workbook.
            }
        }

        foreach (var workbookPath in Directory.EnumerateFiles(dadosFolder, "*.xlsx"))
        {
            if (activeFileNames.Contains(Path.GetFileName(workbookPath)))
            {
                continue;
            }

            try
            {
                File.Delete(workbookPath);
            }
            catch
            {
                // If a file is temporarily locked, the next save/import/recovery can retry cleanup.
            }
        }
    }

    private static IEnumerable<WorkbookSnapshot> GetActiveWorkbookSnapshots(
        string appFolder,
        IEnumerable<WorkbookSource> sources
    )
    {
        foreach (var source in sources)
        {
            var control = LoadWorkbookControl(
                appFolder,
                source.ControlPath,
                source.InferKnownWorkbooks
            );
            var workbookPath = ResolveWorkbookPath(appFolder, control.OnUseFile);

            if (workbookPath is null || !File.Exists(workbookPath))
            {
                continue;
            }

            yield return new WorkbookSnapshot(
                source.EntityId,
                source.EntityName,
                source.CheckpointFileName,
                Path.GetFileName(workbookPath),
                workbookPath
            );
        }
    }

    private static bool HasActiveWorkbookData(string appFolder)
    {
        return GetActiveWorkbookSnapshots(appFolder, GetWorkbookSources(appFolder)).Any();
    }

    private static WorkbookSource[] GetWorkbookSources(string appFolder)
    {
        var baseSource = new WorkbookSource(
            "base-workbook",
            "DadosElevar",
            "DadosElevar.xlsx",
            GetBaseWorkbookControlPath(appFolder),
            false
        );

        var baseControl = LoadWorkbookControl(appFolder, baseSource.ControlPath, true);
        var baseWorkbookPath = ResolveWorkbookPath(appFolder, baseControl.OnUseFile);

        if (baseWorkbookPath is not null && File.Exists(baseWorkbookPath))
        {
            return [baseSource];
        }

        return
        [
            new WorkbookSource(
                "aprendizes",
                "Aprendizes",
                "Aprendizes.xlsx",
                GetWorkbookControlPath(appFolder),
                true
            ),
            new WorkbookSource(
                "turmas",
                "Turmas",
                "Turmas.xlsx",
                GetTurmasWorkbookControlPath(appFolder),
                false
            )
        ];
    }

    private static void WriteCheckpointManifest(
        string checkpointPath,
        string reason,
        IEnumerable<WorkbookSnapshot> snapshots
    )
    {
        var manifest = new
        {
            schemaVersion = 1,
            reason,
            createdAt = DateTime.Now.ToString("O"),
            files = snapshots.Select(snapshot => new
            {
                entityId = snapshot.EntityId,
                entityName = snapshot.EntityName,
                checkpointFileName = snapshot.CheckpointFileName,
                sourceFileName = snapshot.SourceFileName
            })
        };

        File.WriteAllText(
            Path.Combine(checkpointPath, "checkpoint.json"),
            JsonSerializer.Serialize(manifest, PrettyUtf8JsonOptions),
            Encoding.UTF8
        );
    }

    private static GlobalCheckpointControl LoadGlobalCheckpointControl(string appFolder)
    {
        GlobalCheckpointControl? control = null;
        var controlPath = GetGlobalCheckpointControlPath(appFolder);

        try
        {
            if (File.Exists(controlPath))
            {
                control = JsonSerializer.Deserialize<GlobalCheckpointControl>(
                    File.ReadAllText(controlPath)
                );
            }
        }
        catch
        {
            control = null;
        }

        control ??= new GlobalCheckpointControl();
        NormalizeGlobalCheckpointControl(appFolder, control);
        control.HasEditingHistory ??= control.RecoveryEnabled == true;
        control.CaptureBackupOnNextSave ??= false;

        if (IsEmptyGlobalCheckpointControl(control))
        {
            DeleteFileIfExists(controlPath);
        }
        else
        {
            SaveGlobalCheckpointControl(appFolder, control);
        }

        return control;
    }

    private static void NormalizeGlobalCheckpointControl(
        string appFolder,
        GlobalCheckpointControl control
    )
    {
        var checkpoints = control.Checkpoints ?? [];
        var hasActiveWorkbookData = HasActiveWorkbookData(appFolder);

        if (
            checkpoints.Count == 0 &&
            !string.IsNullOrWhiteSpace(control.CheckpointId)
        )
        {
            checkpoints.Add(
                new GlobalCheckpointEntry
                {
                    CheckpointId = control.CheckpointId,
                    Reason = control.Reason,
                    CreatedAt = control.CreatedAt,
                    RecoveryEnabled = control.RecoveryEnabled,
                    IsEmpty = ResolveGlobalCheckpointPath(appFolder, control.CheckpointId) is null
                        ? true
                        : null,
                    ImportCount = NormalizeBackupReason(control.Reason) == BackupReasonBeforeImport
                        ? 1
                        : null
                }
            );
        }

        control.Checkpoints = checkpoints
            .Where(entry =>
                !string.IsNullOrWhiteSpace(entry.CheckpointId) &&
                ((entry.IsEmpty == true && hasActiveWorkbookData) ||
                    ResolveGlobalCheckpointPath(appFolder, entry.CheckpointId) is not null)
            )
            .Select(entry => new GlobalCheckpointEntry
            {
                CheckpointId = entry.CheckpointId,
                Reason = NormalizeBackupReason(entry.Reason),
                CreatedAt = entry.CreatedAt,
                RecoveryEnabled = entry.RecoveryEnabled ?? true,
                IsEmpty = entry.IsEmpty == true ? true : null,
                ImportCount = NormalizeBackupReason(entry.Reason) == BackupReasonBeforeImport
                    ? Math.Max(1, entry.ImportCount ?? 1)
                    : null
            })
            .OrderByDescending(entry =>
                DateTime.TryParse(entry.CreatedAt, out var createdAt)
                    ? createdAt
                    : DateTime.MinValue
            )
            .Take(MaxGlobalCheckpoints)
            .ToList();

        MirrorLatestGlobalCheckpoint(control);
    }

    private static void MirrorLatestGlobalCheckpoint(GlobalCheckpointControl control)
    {
        var latestCheckpoint = control.Checkpoints?.FirstOrDefault();

        control.CheckpointId = latestCheckpoint?.CheckpointId;
        control.Reason = NormalizeBackupReason(latestCheckpoint?.Reason);
        control.CreatedAt = latestCheckpoint?.CreatedAt;
        control.RecoveryEnabled =
            latestCheckpoint is not null && latestCheckpoint.RecoveryEnabled == true;
    }

    private static void SaveGlobalCheckpointControl(
        string appFolder,
        GlobalCheckpointControl control
    )
    {
        MirrorLatestGlobalCheckpoint(control);
        var controlPath = GetGlobalCheckpointControlPath(appFolder);
        Directory.CreateDirectory(Path.GetDirectoryName(controlPath) ?? GetDadosFolder(appFolder));
        File.WriteAllText(
            controlPath,
            JsonSerializer.Serialize(control, PrettyUtf8JsonOptions),
            Encoding.UTF8
        );
    }

    private static string? ResolveGlobalCheckpointPath(string appFolder, string? checkpointId)
    {
        if (string.IsNullOrWhiteSpace(checkpointId))
        {
            return null;
        }

        var safeCheckpointId = Path.GetFileName(checkpointId);

        if (string.IsNullOrWhiteSpace(safeCheckpointId))
        {
            return null;
        }

        var checkpointPath = Path.Combine(GetGlobalCheckpointsFolder(appFolder), safeCheckpointId);

        if (File.Exists(checkpointPath) || Directory.Exists(checkpointPath))
        {
            return checkpointPath;
        }

        return null;
    }

    private static bool IsGlobalCheckpointLocationAvailable(string? checkpointPath)
    {
        return checkpointPath is not null &&
            (File.Exists(checkpointPath) || Directory.Exists(checkpointPath));
    }

    private static string? ResolveGlobalCheckpointWorkbookFile(
        string? checkpointPath,
        WorkbookSource source
    )
    {
        if (checkpointPath is null)
        {
            return null;
        }

        if (File.Exists(checkpointPath))
        {
            return checkpointPath;
        }

        if (!Directory.Exists(checkpointPath))
        {
            return null;
        }

        var checkpointFile = Path.Combine(checkpointPath, source.CheckpointFileName);
        return File.Exists(checkpointFile) ? checkpointFile : null;
    }

    private static void DeleteGlobalCheckpointLocation(string checkpointPath)
    {
        if (File.Exists(checkpointPath))
        {
            File.Delete(checkpointPath);
            return;
        }

        if (Directory.Exists(checkpointPath))
        {
            Directory.Delete(checkpointPath, true);
        }
    }

    private static string CreateCheckpointId()
    {
        return DateTime.Now.ToString("yyyyMMddHHmmssfff");
    }

    private static string CreateEmptyCheckpointId(string appFolder)
    {
        var checkpointsFolder = GetGlobalCheckpointsFolder(appFolder);
        var checkpointId = $"empty_{DateTime.Now:HHmmssfffddMMyy}";
        var suffix = 2;

        while (
            File.Exists(Path.Combine(checkpointsFolder, checkpointId)) ||
            Directory.Exists(Path.Combine(checkpointsFolder, checkpointId))
        )
        {
            checkpointId = $"empty_{DateTime.Now:HHmmssfffddMMyy}_{suffix}";
            suffix += 1;
        }

        return checkpointId;
    }

    private static void StartTurmasWorkbookSession(string appFolder)
    {
        _ = LoadTurmasWorkbookControl(appFolder);
        StartWorkbookSession(appFolder, GetTurmasWorkbookControlPath(appFolder));
    }

    private static void StartBaseWorkbookSession(string appFolder)
    {
        StartWorkbookSession(appFolder, GetBaseWorkbookControlPath(appFolder));
    }

    private static string? FindCurrentWorkbookPath(string appFolder)
    {
        var control = LoadWorkbookControl(appFolder);
        return ResolveWorkbookPath(appFolder, control.OnUseFile);
    }

    private static WorkbookControl LoadTurmasWorkbookControl(string appFolder)
    {
        var controlPath = GetTurmasWorkbookControlPath(appFolder);

        if (!File.Exists(controlPath))
        {
            var meta = LoadSimpleWorkbookMeta(GetTurmasMetaPath(appFolder));

            if (!string.IsNullOrWhiteSpace(meta.OnUseFile))
            {
                SaveWorkbookControl(
                    appFolder,
                    new WorkbookControl
                    {
                        OnUseFile = meta.OnUseFile,
                        BackupFile = null,
                        BackupReason = null,
                        RecoveryEnabled = false,
                        HasEditingHistory = false,
                        CaptureBackupOnNextSave = false
                    },
                    controlPath
                );
            }
        }

        return LoadWorkbookControl(appFolder, controlPath, false);
    }

    private static WorkbookControl LoadWorkbookControl(
        string appFolder,
        string? controlPath = null,
        bool inferKnownWorkbooks = true
    )
    {
        MigrateLegacyPlanilhasFolder(appFolder);
        controlPath ??= GetWorkbookControlPath(appFolder);
        WorkbookControl? control = null;

        try
        {
            if (File.Exists(controlPath))
            {
                control = JsonSerializer.Deserialize<WorkbookControl>(
                    File.ReadAllText(controlPath)
                );
            }
        }
        catch
        {
            control = null;
        }

        control ??= new WorkbookControl();
        control.OnUseFile = NormalizeTrackedWorkbookFileName(control.OnUseFile);
        control.BackupFile = NormalizeTrackedWorkbookFileName(control.BackupFile);
        control.BackupReason = NormalizeBackupReason(control.BackupReason);

        if (ResolveWorkbookPath(appFolder, control.OnUseFile) is null)
        {
            control.OnUseFile = null;
        }

        if (ResolveWorkbookPath(appFolder, control.BackupFile) is null)
        {
            control.BackupFile = null;
            control.BackupReason = null;
            control.RecoveryEnabled = false;
            control.HasEditingHistory = false;
            control.CaptureBackupOnNextSave = false;
        }

        if (control.OnUseFile is null && inferKnownWorkbooks)
        {
            var knownWorkbooks = GetKnownWorkbookFiles(appFolder, controlPath)
                .Take(2)
                .ToArray();

            control.OnUseFile = knownWorkbooks.ElementAtOrDefault(0)?.Name;
            control.BackupFile = knownWorkbooks.ElementAtOrDefault(1)?.Name;
            control.BackupReason = control.BackupFile is null
                ? null
                : BackupReasonBeforeSessionEdit;
            control.RecoveryEnabled = control.BackupFile is not null;
            control.HasEditingHistory = control.BackupFile is not null;
            control.CaptureBackupOnNextSave = false;
        }

        if (control.OnUseFile is null)
        {
            control.RecoveryEnabled = false;
            control.HasEditingHistory = false;
            control.CaptureBackupOnNextSave = false;
        }

        if (control.BackupFile is not null && control.BackupReason is null)
        {
            control.BackupReason = BackupReasonBeforeSessionEdit;
        }

        control.RecoveryEnabled ??= control.BackupFile is not null &&
            control.BackupReason != BackupReasonRestored;
        control.HasEditingHistory ??= control.BackupReason switch
        {
            BackupReasonBeforeEdit => true,
            BackupReasonBeforeSessionEdit => true,
            BackupReasonImportOriginal => control.RecoveryEnabled == true,
            _ => false
        };
        control.CaptureBackupOnNextSave ??= false;

        if (control.BackupReason == BackupReasonRestored)
        {
            control.RecoveryEnabled = false;
            control.HasEditingHistory = false;
            control.CaptureBackupOnNextSave = false;
        }

        if (
            control.BackupReason == BackupReasonBeforeRecovery &&
            control.OnUseFile is not null &&
            control.BackupFile is not null &&
            !string.Equals(control.OnUseFile, control.BackupFile, StringComparison.OrdinalIgnoreCase)
        )
        {
            control.RecoveryEnabled = true;
        }

        if (IsEmptyWorkbookControl(control))
        {
            DeleteFileIfExists(controlPath);
        }
        else
        {
            SaveWorkbookControl(appFolder, control, controlPath);
        }

        return control;
    }

    private static void SaveWorkbookControl(
        string appFolder,
        WorkbookControl control,
        string? controlPath = null
    )
    {
        var targetPath = controlPath ?? GetWorkbookControlPath(appFolder);
        Directory.CreateDirectory(Path.GetDirectoryName(targetPath) ?? GetDadosFolder(appFolder));
        File.WriteAllText(
            targetPath,
            JsonSerializer.Serialize(control, PrettyUtf8JsonOptions),
            Encoding.UTF8
        );
    }

    private static bool IsEmptyWorkbookControl(WorkbookControl control)
    {
        return string.IsNullOrWhiteSpace(control.OnUseFile) &&
            string.IsNullOrWhiteSpace(control.BackupFile) &&
            string.IsNullOrWhiteSpace(control.BackupReason) &&
            control.RecoveryEnabled != true &&
            control.HasEditingHistory != true &&
            control.CaptureBackupOnNextSave != true;
    }

    private static bool IsEmptyGlobalCheckpointControl(GlobalCheckpointControl control)
    {
        return (control.Checkpoints is null || control.Checkpoints.Count == 0) &&
            string.IsNullOrWhiteSpace(control.CheckpointId) &&
            string.IsNullOrWhiteSpace(control.Reason) &&
            string.IsNullOrWhiteSpace(control.CreatedAt) &&
            control.RecoveryEnabled != true &&
            control.HasEditingHistory != true &&
            control.CaptureBackupOnNextSave != true &&
            string.IsNullOrWhiteSpace(control.LastCheckpointAction);
    }

    private static void DeleteFileIfExists(string? filePath)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(filePath) && File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }
        catch
        {
            // Cleanup is best-effort; a locked file can be retried on the next launch.
        }
    }

    private static string? ResolveWorkbookPath(string appFolder, string? fileName)
    {
        var normalizedName = NormalizeTrackedWorkbookFileName(fileName);

        if (normalizedName is null)
        {
            return null;
        }

        var path = Path.Combine(GetDadosFolder(appFolder), normalizedName);

        return File.Exists(path) ? path : null;
    }

    private static string? NormalizeTrackedWorkbookFileName(string? fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName))
        {
            return null;
        }

        var safeName = Path.GetFileName(fileName);

        if (
            string.IsNullOrWhiteSpace(safeName) ||
            safeName.StartsWith("~$", StringComparison.Ordinal) ||
            !safeName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
        )
        {
            return null;
        }

        return safeName;
    }

    private static IEnumerable<FileInfo> GetKnownWorkbookFiles(
        string appFolder,
        string? controlPath = null
    )
    {
        var dadosFolder = GetDadosFolder(appFolder);

        if (!Directory.Exists(dadosFolder))
        {
            return Enumerable.Empty<FileInfo>();
        }

        var searchPattern = "Aprendizes*.xlsx";

        if (
            controlPath is not null &&
            string.Equals(
                controlPath,
                GetBaseWorkbookControlPath(appFolder),
                StringComparison.OrdinalIgnoreCase
            )
        )
        {
            searchPattern = "DadosElevar*.xlsx";
        }
        else if (
            controlPath is not null &&
            string.Equals(
                controlPath,
                GetTurmasWorkbookControlPath(appFolder),
                StringComparison.OrdinalIgnoreCase
            )
        )
        {
            searchPattern = "Turmas*.xlsx";
        }

        return Directory
            .GetFiles(dadosFolder, searchPattern, SearchOption.TopDirectoryOnly)
            .Select(path => new FileInfo(path))
            .Where(file => !file.Name.StartsWith("~$", StringComparison.Ordinal))
            .OrderByDescending(file => file.LastWriteTimeUtc);
    }

    private static string GetWorkbookMetaPath(string appFolder)
    {
        return Path.Combine(GetDadosFolder(appFolder), "aprendizes.json");
    }

    private static string GetUniqueTimestampedWorkbookName(string folder)
    {
        return GetUniqueTimestampedWorkbookName(folder, "Aprendizes");
    }

    private static string GetUniqueTimestampedWorkbookName(string folder, string entityName)
    {
        var baseName = $"{entityName}_{DateTime.Now:HHmmssddMMyy}";
        var candidate = $"{baseName}.xlsx";
        var suffix = 2;

        while (File.Exists(Path.Combine(folder, candidate)))
        {
            candidate = $"{baseName}_{suffix}.xlsx";
            suffix += 1;
        }

        return candidate;
    }

    private static SimpleWorkbookMeta LoadSimpleWorkbookMeta(string metadataPath)
    {
        SimpleWorkbookMeta? meta = null;

        try
        {
            if (File.Exists(metadataPath))
            {
                meta = JsonSerializer.Deserialize<SimpleWorkbookMeta>(
                    File.ReadAllText(metadataPath)
                );
            }
        }
        catch
        {
            meta = null;
        }

        meta ??= new SimpleWorkbookMeta();
        meta.OnUseFile = NormalizeTrackedWorkbookFileName(meta.OnUseFile);
        return meta;
    }

    private static void SaveSimpleWorkbookMeta(string metadataPath, SimpleWorkbookMeta meta)
    {
        var metadataFolder = Path.GetDirectoryName(metadataPath);

        if (!string.IsNullOrWhiteSpace(metadataFolder))
        {
            Directory.CreateDirectory(metadataFolder);
        }

        File.WriteAllText(
            metadataPath,
            JsonSerializer.Serialize(meta, PrettyUtf8JsonOptions),
            Encoding.UTF8
        );
    }

    private static string? NormalizeBackupReason(string? reason)
    {
        return reason switch
        {
            BackupReasonBeforeImport => BackupReasonBeforeImport,
            BackupReasonBeforeEdit => BackupReasonBeforeEdit,
            BackupReasonBeforeSessionEdit => BackupReasonBeforeSessionEdit,
            BackupReasonImportOriginal => BackupReasonImportOriginal,
            BackupReasonBeforeRecovery => BackupReasonBeforeRecovery,
            BackupReasonAfterRecovery => BackupReasonBeforeRecovery,
            "previous_session" => BackupReasonBeforeSessionEdit,
            BackupReasonRestored => BackupReasonRestored,
            _ => null
        };
    }

    private static string FormatBackupDateTime(DateTime dateTime)
    {
        return $"{dateTime:HH:mm:ss} {dateTime:dd/MM/yyyy}";
    }

    private static DateTime? ParseIsoDateTime(string? value)
    {
        return DateTime.TryParse(value, out var parsedDateTime)
            ? parsedDateTime
            : null;
    }

    private static void MigrateLegacyPlanilhasFolder(string appFolder)
    {
        try
        {
            var dadosFolder = GetDadosFolder(appFolder);
            var legacyFolder = Path.Combine(dadosFolder, "planilhas");

            if (!Directory.Exists(legacyFolder))
            {
                return;
            }

            Directory.CreateDirectory(dadosFolder);

            foreach (var filePath in Directory.GetFiles(legacyFolder))
            {
                var fileName = Path.GetFileName(filePath);

                if (fileName == ".gitkeep")
                {
                    File.Delete(filePath);
                    continue;
                }

                var targetPath = Path.Combine(dadosFolder, fileName);

                if (File.Exists(targetPath))
                {
                    var extension = Path.GetExtension(fileName);
                    var nameWithoutExtension = Path.GetFileNameWithoutExtension(fileName);
                    targetPath = Path.Combine(
                        dadosFolder,
                        $"{nameWithoutExtension}_{DateTime.Now:HHmmssddMMyy}{extension}"
                    );
                }

                File.Move(filePath, targetPath);
            }

            Directory.Delete(legacyFolder, recursive: true);
        }
        catch
        {
            // Legacy cleanup is best-effort; current reads/writes use dados/ directly.
        }
    }

    private static void DeleteLegacyMetadata(string appFolder)
    {
        try
        {
            var metadataPath = GetWorkbookMetaPath(appFolder);

            if (File.Exists(metadataPath))
            {
                File.Delete(metadataPath);
            }
        }
        catch
        {
            // Old metadata is not required for the current file discovery model.
        }
    }

    private static string GetContentType(string extension)
    {
        return extension.ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".png" => "image/png",
            ".jpg" => "image/jpeg",
            ".jpeg" => "image/jpeg",
            ".svg" => "image/svg+xml",
            ".json" => "application/json; charset=utf-8",
            ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            _ => "application/octet-stream"
        };
    }

    private static void ShowMessage(string message, string title)
    {
        MessageBoxW(IntPtr.Zero, message, title, 0x00000010);
    }

    private static int GetIntEnvironment(string name, int fallback)
    {
        return int.TryParse(Environment.GetEnvironmentVariable(name), out var value)
            ? value
            : fallback;
    }

    private static void Log(string message)
    {
        try
        {
            if (_logPath is null)
            {
                return;
            }

            File.AppendAllText(_logPath, $"[{DateTime.Now:O}] {message}{Environment.NewLine}");
        }
        catch
        {
            // Logging should never block app startup.
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        IntPtr hwnd,
        int attribute,
        ref int attributeValue,
        int attributeSize
    );

    private sealed record HttpRequest(
        string Method,
        string Path,
        Dictionary<string, string> Headers,
        byte[] Body
    );

    private sealed class WorkbookControl
    {
        public string? OnUseFile { get; set; }
        public string? BackupFile { get; set; }
        public string? BackupReason { get; set; }
        public bool? RecoveryEnabled { get; set; }
        public bool? HasEditingHistory { get; set; }
        public bool? CaptureBackupOnNextSave { get; set; }
    }

    private sealed class GlobalCheckpointControl
    {
        public string? CheckpointId { get; set; }
        public string? Reason { get; set; }
        public string? CreatedAt { get; set; }
        public bool? RecoveryEnabled { get; set; }
        public bool? HasEditingHistory { get; set; }
        public bool? CaptureBackupOnNextSave { get; set; }
        public List<GlobalCheckpointEntry>? Checkpoints { get; set; }
        public string? LastCheckpointAction { get; set; }
    }

    private sealed class GlobalCheckpointEntry
    {
        public string? CheckpointId { get; set; }
        public string? Reason { get; set; }
        public string? CreatedAt { get; set; }
        public bool? RecoveryEnabled { get; set; }
        public int? ImportCount { get; set; }
        public bool? IsEmpty { get; set; }
    }

    private sealed record WorkbookSource(
        string EntityId,
        string EntityName,
        string CheckpointFileName,
        string ControlPath,
        bool InferKnownWorkbooks
    );

    private sealed record WorkbookSnapshot(
        string EntityId,
        string EntityName,
        string CheckpointFileName,
        string SourceFileName,
        string Path
    );

    private sealed class SimpleWorkbookMeta
    {
        public string? OnUseFile { get; set; }
    }

    private sealed class RuntimeWindowSettings
    {
        public double? ZoomFactor { get; set; }
        public bool? DarkMode { get; set; }
        public string? BackgroundColor { get; set; }
        public string? TitleBarColor { get; set; }
        public string? TitleTextColor { get; set; }
    }

    private sealed class AppWindow : Form
    {
        private readonly string _appFolder;
        private readonly string _url;
        private readonly Color _startupBackgroundColor;
        private WebView2 _webView;
        private Panel _startupCover;
        private int _isWebViewRevealed;

        public AppWindow(string url, string appFolder)
        {
            _appFolder = appFolder;
            _url = url;
            _webView = new WebView2
            {
                Dock = DockStyle.Fill
            };
            var startupTheme = LoadWindowSettings();
            var startupBackground = ChooseHexColor(
                startupTheme.BackgroundColor,
                startupTheme.DarkMode == true,
                "#000000",
                "#fafdff"
            );
            _startupBackgroundColor = ColorTranslator.FromHtml(startupBackground);

            Text = Title;
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(744, 520);
            Size = new Size(1280, 820);
            WindowState = FormWindowState.Maximized;
            Opacity = 0;
            BackColor = _startupBackgroundColor;
            _webView.DefaultBackgroundColor = _startupBackgroundColor;
            _startupCover = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = _startupBackgroundColor
            };

            try
            {
                Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? Application.ExecutablePath);
            }
            catch
            {
                // The embedded exe icon is cosmetic; the app can run without it.
            }

            Controls.Add(_webView);
            Controls.Add(_startupCover);
            _startupCover.BringToFront();
            Shown += async (_, _) => await InitializeWebViewAsync();
            FormClosed += (_, _) => RequestShutdown("window-closed");

            SetTitleBarTheme(
                startupTheme.DarkMode == true,
                startupTheme.TitleBarColor,
                startupTheme.TitleTextColor
            );
        }

        public void SetTitleBarTheme(bool darkMode, string? titleBarColor, string? titleTextColor)
        {
            var captionColor = ToColorRef(ChooseHexColor(titleBarColor, darkMode, "#000000", "#fafdff"));
            var textColor = ToColorRef(ChooseHexColor(titleTextColor, darkMode, "#ffffff", "#000000"));

            TrySetDwmColor(35, captionColor);
            TrySetDwmColor(36, textColor);
        }

        public string? PickWorkbookExportPath(string defaultFileName)
        {
            using var dialog = new SaveFileDialog
            {
                AddExtension = true,
                CheckPathExists = true,
                CreatePrompt = false,
                DefaultExt = "xlsx",
                FileName = defaultFileName,
                Filter = "Planilha Excel (*.xlsx)|*.xlsx",
                InitialDirectory = GetDownloadsFolder(),
                OverwritePrompt = true,
                RestoreDirectory = true,
                SupportMultiDottedExtensions = true,
                Title = "Exportar planilha"
            };

            return dialog.ShowDialog(this) == DialogResult.OK
                ? dialog.FileName
                : null;
        }

        public string? PickEmentaPdfPath()
        {
            using var dialog = new OpenFileDialog
            {
                AddExtension = true,
                CheckFileExists = true,
                CheckPathExists = true,
                DefaultExt = "pdf",
                Filter = "Ementa PDF (*.pdf)|*.pdf",
                InitialDirectory = GetDownloadsFolder(),
                Multiselect = false,
                RestoreDirectory = true,
                SupportMultiDottedExtensions = true,
                Title = "Adicionar ementa"
            };

            return dialog.ShowDialog(this) == DialogResult.OK
                ? dialog.FileName
                : null;
        }

        private async Task InitializeWebViewAsync()
        {
            try
            {
                var userDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "SejaElevar",
                    "WebView2-runtime"
                );
                await EnsureWebViewWithProfileAsync(userDataFolder);
                Log($"WebView runtime: {_webView.CoreWebView2.Environment.BrowserVersionString}");
                _webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
                _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                _webView.CoreWebView2.NavigationStarting += (_, args) =>
                    Log($"WebView navigation starting: {args.Uri}");
                _webView.CoreWebView2.NavigationCompleted += (_, args) =>
                {
                    Log(
                        $"WebView navigation completed: success={args.IsSuccess} status={args.HttpStatusCode} error={args.WebErrorStatus}"
                    );
                };
                _webView.CoreWebView2.ProcessFailed += (_, args) =>
                    Log($"WebView process failed: {args.ProcessFailedKind}");
                _webView.ZoomFactor = LoadZoomFactor();
                _webView.ZoomFactorChanged += (_, _) => SaveZoomFactor(_webView.ZoomFactor);
                _webView.CoreWebView2.NavigationCompleted += (_, _) => ScheduleFallbackReveal();
                _webView.CoreWebView2.Navigate(_url);
            }
            catch (Exception error)
            {
                Log($"WebView failed: {error}");
                MessageBox.Show(
                    this,
                    $"Nao foi possivel abrir a janela do SejaElevar.\n\n{error.Message}",
                    Title,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                RequestShutdown("webview-failed");
            }
        }

        private async Task EnsureWebViewWithProfileAsync(string userDataFolder)
        {
            try
            {
                await EnsureWebViewCoreAsync(userDataFolder);
            }
            catch (Exception error) when (IsRecoverableWebViewStartupError(error))
            {
                var fallbackFolder = Path.Combine(
                    Path.GetTempPath(),
                    "SejaElevar",
                    $"WebView2-recovery-{DateTime.Now:yyyyMMddHHmmss}"
                );
                Log(
                    $"WebView profile failed ({GetErrorCode(error)}); retrying with {fallbackFolder}"
                );
                ResetWebViewControl();
                await EnsureWebViewCoreAsync(fallbackFolder);
            }
        }

        private void ResetWebViewControl()
        {
            try
            {
                Controls.Remove(_webView);
                _webView.Dispose();
            }
            catch
            {
                // The failed control may already be partially disposed.
            }

            _webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = _startupBackgroundColor
            };
            Controls.Add(_webView);
            _startupCover.Visible = true;
            _startupCover.BringToFront();
        }

        private async Task EnsureWebViewCoreAsync(string userDataFolder)
        {
            Directory.CreateDirectory(userDataFolder);
            Log($"WebView profile: {userDataFolder}");
            var environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder
            );

            await _webView.EnsureCoreWebView2Async(environment);
        }

        private static bool IsRecoverableWebViewStartupError(Exception error)
        {
            return error is UnauthorizedAccessException ||
                error is IOException ||
                error.HResult is unchecked((int)0x800700AA) or unchecked((int)0x8000FFFF);
        }

        private static string GetErrorCode(Exception error)
        {
            return error.HResult == 0
                ? error.GetType().Name
                : $"{error.HResult:X8}";
        }

        private string GetWindowSettingsPath()
        {
            return Path.Combine(GetAssetsFolder(_appFolder), "window-settings.json");
        }

        private static string GetDownloadsFolder()
        {
            var downloadsFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Downloads"
            );

            return Directory.Exists(downloadsFolder)
                ? downloadsFolder
                : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        }

        private double LoadZoomFactor()
        {
            return ClampZoomFactor(LoadWindowSettings().ZoomFactor ?? DefaultZoomFactor);
        }

        private RuntimeWindowSettings LoadWindowSettings()
        {
            try
            {
                var settingsPath = GetWindowSettingsPath();

                if (!File.Exists(settingsPath))
                {
                    return new RuntimeWindowSettings();
                }

                return JsonSerializer.Deserialize<RuntimeWindowSettings>(
                    File.ReadAllText(settingsPath)
                ) ?? new RuntimeWindowSettings();
            }
            catch
            {
                return new RuntimeWindowSettings();
            }
        }

        private void SaveZoomFactor(double zoomFactor)
        {
            try
            {
                Directory.CreateDirectory(GetAssetsFolder(_appFolder));
                var settings = LoadWindowSettings();
                settings.ZoomFactor = ClampZoomFactor(zoomFactor);
                File.WriteAllText(
                    GetWindowSettingsPath(),
                    JsonSerializer.Serialize(settings, PrettyUtf8JsonOptions),
                    Encoding.UTF8
                );
            }
            catch
            {
                // Zoom is a convenience setting; the app should keep running if it cannot be saved.
            }
        }

        public void SaveWindowThemeSettings(
            bool darkMode,
            string? backgroundColor,
            string? titleBarColor,
            string? titleTextColor
        )
        {
            var settings = LoadWindowSettings();
            settings.DarkMode = darkMode;
            settings.BackgroundColor = IsHexColor(backgroundColor) ? backgroundColor : null;
            settings.TitleBarColor = IsHexColor(titleBarColor) ? titleBarColor : null;
            settings.TitleTextColor = IsHexColor(titleTextColor) ? titleTextColor : null;
            Directory.CreateDirectory(GetAssetsFolder(_appFolder));
            File.WriteAllText(
                GetWindowSettingsPath(),
                JsonSerializer.Serialize(settings, PrettyUtf8JsonOptions),
                Encoding.UTF8
            );
        }

        private static double ClampZoomFactor(double zoomFactor)
        {
            if (double.IsNaN(zoomFactor) || double.IsInfinity(zoomFactor))
            {
                return DefaultZoomFactor;
            }

            return Math.Clamp(zoomFactor, 0.5, 3.0);
        }

        private void ScheduleFallbackReveal()
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(4000);
                RevealWebView();
            });
        }

        public void RevealWebView()
        {
            if (IsDisposed || Interlocked.Exchange(ref _isWebViewRevealed, 1) == 1)
            {
                return;
            }

            BeginInvoke(() =>
            {
                if (IsDisposed)
                {
                    return;
                }

                Log("WebView revealing after app startup");
                _webView.Visible = true;
                _webView.BringToFront();
                _startupCover.Visible = false;
                Opacity = 1;
                Activate();
            });
        }

        private void TrySetDwmColor(int attribute, int color)
        {
            try
            {
                DwmSetWindowAttribute(Handle, attribute, ref color, sizeof(int));
            }
            catch
            {
                // Older Windows builds may ignore custom caption colors.
            }
        }

        private static int ToColorRef(string hex)
        {
            var value = hex.TrimStart('#');
            var red = Convert.ToInt32(value[..2], 16);
            var green = Convert.ToInt32(value.Substring(2, 2), 16);
            var blue = Convert.ToInt32(value.Substring(4, 2), 16);

            return red | (green << 8) | (blue << 16);
        }

        private static bool IsHexColor(string? value)
        {
            if (value is null || value.Length != 7 || value[0] != '#')
            {
                return false;
            }

            return value.Skip(1).All(Uri.IsHexDigit);
        }

        private static string ChooseHexColor(
            string? requestedColor,
            bool darkMode,
            string darkFallback,
            string lightFallback
        )
        {
            return IsHexColor(requestedColor)
                ? requestedColor!
                : darkMode
                    ? darkFallback
                    : lightFallback;
        }
    }
}
