using System.Drawing;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
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
        MigrateLegacyPlanilhasFolder(appFolder);
        StartWorkbookSession(appFolder);
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
            using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(180) };
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

            if (request.Method == "GET" && request.Path == "/api/aprendizes/file")
            {
                MarkHeartbeat();
                await ServeWorkbookAsync(stream, appFolder);
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/aprendizes/export")
            {
                MarkHeartbeat();
                await ExportWorkbookAsync(stream, appFolder);
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/data-index")
            {
                MarkHeartbeat();
                await ServeDataIndexAsync(stream, appFolder);
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
                await ServeBackupInfoAsync(stream, appFolder);
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/aprendizes/recover")
            {
                MarkHeartbeat();
                await RecoverWorkbookBackupAsync(stream, appFolder);
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
                    await SaveEditedWorkbookAsync(stream, request, appFolder);
                }

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

    private static async Task ServeWorkbookAsync(NetworkStream stream, string appFolder)
    {
        var control = LoadWorkbookControl(appFolder);
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

    private static async Task ExportWorkbookAsync(NetworkStream stream, string appFolder)
    {
        var control = LoadWorkbookControl(appFolder);
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

    private static async Task ImportWorkbookAsync(
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
        var control = LoadWorkbookControl(appFolder);
        var previousOnUsePath = ResolveWorkbookPath(appFolder, control.OnUseFile);
        var previousBackupPath = ResolveWorkbookPath(appFolder, control.BackupFile);
        var importedFileName = GetUniqueTimestampedWorkbookName(dadosFolder);
        var targetPath = Path.Combine(dadosFolder, importedFileName);

        DeleteLegacyMetadata(appFolder);
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
            BackupFile = previousOnUsePath is null
                ? importedFileName
                : Path.GetFileName(previousOnUsePath),
            BackupReason = previousOnUsePath is null
                ? BackupReasonImportOriginal
                : BackupReasonBeforeImport,
            RecoveryEnabled = previousOnUsePath is not null,
            HasEditingHistory = false,
            CaptureBackupOnNextSave = false
        };

        SaveWorkbookControl(appFolder, nextControl);

        await WriteJsonAsync(
            stream,
            200,
            new
            {
                ok = true,
                fileName = importedFileName,
                onUseFile = nextControl.OnUseFile,
                backupFile = nextControl.BackupFile
            }
        );
    }

    private static async Task SaveEditedWorkbookAsync(
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
        var control = LoadWorkbookControl(appFolder);
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
        var targetFileName = GetUniqueTimestampedWorkbookName(dadosFolder);
        var targetPath = Path.Combine(dadosFolder, targetFileName);

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
            BackupFile = shouldPreserveOnUseAsBackup && onUsePath is not null
                ? Path.GetFileName(onUsePath)
                : control.BackupFile,
            BackupReason = shouldCaptureSessionStart
                ? BackupReasonBeforeEdit
                : control.BackupReason == BackupReasonRestored
                ? BackupReasonAfterRecovery
                : control.BackupReason ?? BackupReasonImportOriginal,
            RecoveryEnabled = true,
            HasEditingHistory = true,
            CaptureBackupOnNextSave = false
        };

        SaveWorkbookControl(appFolder, nextControl);
        DeleteLegacyMetadata(appFolder);
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

    private static async Task ServeBackupInfoAsync(NetworkStream stream, string appFolder)
    {
        var control = LoadWorkbookControl(appFolder);
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
                label = "Aprendizes",
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

    private static async Task RecoverWorkbookBackupAsync(NetworkStream stream, string appFolder)
    {
        var dadosFolder = GetDadosFolder(appFolder);
        Directory.CreateDirectory(dadosFolder);

        var control = LoadWorkbookControl(appFolder);
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

        SaveWorkbookControl(appFolder, nextControl);
        DeleteLegacyMetadata(appFolder);

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

    private static string GetAssetsFolder(string appFolder)
    {
        return Path.Combine(appFolder, "assets");
    }

    private static string GetWorkbookControlPath(string appFolder)
    {
        return Path.Combine(GetDadosFolder(appFolder), "controle.json");
    }

    private static string GetDataSystemFolder(string appFolder)
    {
        return Path.Combine(GetDadosFolder(appFolder), "sistema");
    }

    private static string GetDataIndexPath(string appFolder)
    {
        return Path.Combine(GetDataSystemFolder(appFolder), "data-index.json");
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

    private static void StartWorkbookSession(string appFolder)
    {
        var control = LoadWorkbookControl(appFolder);

        if (control.OnUseFile is null)
        {
            return;
        }

        if (control.BackupReason == BackupReasonBeforeEdit)
        {
            control.BackupReason = BackupReasonBeforeSessionEdit;
        }

        control.CaptureBackupOnNextSave = control.HasEditingHistory == true;
        SaveWorkbookControl(appFolder, control);
    }

    private static string? FindCurrentWorkbookPath(string appFolder)
    {
        var control = LoadWorkbookControl(appFolder);
        return ResolveWorkbookPath(appFolder, control.OnUseFile);
    }

    private static WorkbookControl LoadWorkbookControl(string appFolder)
    {
        MigrateLegacyPlanilhasFolder(appFolder);
        var controlPath = GetWorkbookControlPath(appFolder);
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

        if (control.OnUseFile is null)
        {
            var knownWorkbooks = GetKnownWorkbookFiles(appFolder)
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

        SaveWorkbookControl(appFolder, control);
        return control;
    }

    private static void SaveWorkbookControl(string appFolder, WorkbookControl control)
    {
        var dadosFolder = GetDadosFolder(appFolder);
        Directory.CreateDirectory(dadosFolder);
        File.WriteAllText(
            GetWorkbookControlPath(appFolder),
            JsonSerializer.Serialize(control, PrettyUtf8JsonOptions),
            Encoding.UTF8
        );
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

    private static IEnumerable<FileInfo> GetKnownWorkbookFiles(string appFolder)
    {
        var dadosFolder = GetDadosFolder(appFolder);

        if (!Directory.Exists(dadosFolder))
        {
            return Enumerable.Empty<FileInfo>();
        }

        return Directory
            .GetFiles(dadosFolder, "*.xlsx", SearchOption.TopDirectoryOnly)
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
        var baseName = $"Aprendizes_{DateTime.Now:HHmmssddMMyy}";
        var candidate = $"{baseName}.xlsx";
        var suffix = 2;

        while (File.Exists(Path.Combine(folder, candidate)))
        {
            candidate = $"{baseName}_{suffix}.xlsx";
            suffix += 1;
        }

        return candidate;
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
            BackupReasonAfterRecovery => BackupReasonAfterRecovery,
            "previous_session" => BackupReasonBeforeSessionEdit,
            BackupReasonRestored => BackupReasonRestored,
            _ => null
        };
    }

    private static string FormatBackupDateTime(DateTime dateTime)
    {
        return $"{dateTime:HH}h{dateTime:mm}m{dateTime:ss}s {dateTime:dd/MM/yy}";
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
                _startupCover.Visible = false;
                _webView.BringToFront();
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
