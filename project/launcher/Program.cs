using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private const string Title = "SejaElevar";
    private static readonly int PreferredPort = GetIntEnvironment("SEJAELEVAR_PORT", 3838);
    private static readonly TimeSpan HeartbeatTimeout = TimeSpan.FromMilliseconds(
        GetIntEnvironment("SEJAELEVAR_IDLE_TIMEOUT_MS", 5000)
    );
    private static readonly object HeartbeatLock = new();
    private static DateTime _lastHeartbeatAt = DateTime.UtcNow;
    private static string? _logPath;
    private static TcpListener? _listener;
    private static volatile bool _shutdownRequested;

    [STAThread]
    private static async Task<int> Main()
    {
        if (await TryOpenRunningApp())
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

        Directory.CreateDirectory(GetPlanilhasFolder(appFolder));

        try
        {
            var (listener, port) = BindListener();
            _listener = listener;
            var url = $"http://127.0.0.1:{port}/";
            Log($"Listening on {url}");

            if (Environment.GetEnvironmentVariable("SEJAELEVAR_NO_OPEN") != "1")
            {
                OpenBrowser(url);
            }

            _ = MonitorHeartbeatAsync(listener);

            while (!_shutdownRequested)
            {
                var client = await listener.AcceptTcpClientAsync();
                _ = Task.Run(() => HandleClientAsync(client, appFolder));
            }

            return 0;
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

    private static async Task<bool> TryOpenRunningApp()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(700) };
            var response = await client.GetAsync($"http://127.0.0.1:{PreferredPort}/api/app/status");

            if (!response.IsSuccessStatusCode)
            {
                return false;
            }

            OpenBrowser($"http://127.0.0.1:{PreferredPort}/");
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

            RequestShutdown();
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

            if (request.Method == "POST" && request.Path == "/api/app/closed")
            {
                await WriteJsonAsync(stream, 200, new { ok = true });
                RequestShutdown();
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/aprendizes/file")
            {
                MarkHeartbeat();
                await ServeWorkbookAsync(stream, appFolder);
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

    private static void RequestShutdown()
    {
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
    }

    private static async Task ServeWorkbookAsync(NetworkStream stream, string appFolder)
    {
        var workbookPath = FindCurrentWorkbookPath(appFolder);

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

        var planilhasFolder = GetPlanilhasFolder(appFolder);
        Directory.CreateDirectory(planilhasFolder);
        var importedFileName = request.Headers.TryGetValue("x-file-name", out var rawName)
            ? SanitizeXlsxFileName(Uri.UnescapeDataString(rawName), "Aprendizes.xlsx")
            : "Aprendizes.xlsx";
        var targetPath = Path.Combine(planilhasFolder, importedFileName);

        DeleteLegacyMetadata(appFolder);
        await File.WriteAllBytesAsync(targetPath, request.Body);

        await WriteJsonAsync(stream, 200, new { ok = true, fileName = importedFileName });
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

        var planilhasFolder = GetPlanilhasFolder(appFolder);
        Directory.CreateDirectory(planilhasFolder);
        var previousWorkbookPath = FindCurrentWorkbookPath(appFolder);
        var targetFileName = GetTimestampedWorkbookName();
        var targetPath = Path.Combine(planilhasFolder, targetFileName);

        await File.WriteAllBytesAsync(targetPath, request.Body);

        if (
            previousWorkbookPath is not null &&
            !string.Equals(previousWorkbookPath, targetPath, StringComparison.OrdinalIgnoreCase) &&
            File.Exists(previousWorkbookPath)
        )
        {
            File.Delete(previousWorkbookPath);
        }

        DeleteLegacyMetadata(appFolder);
        await WriteJsonAsync(stream, 200, new { ok = true, fileName = targetFileName });
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
            await File.ReadAllBytesAsync(fullPath)
        );
    }

    private static Task WriteJsonAsync(NetworkStream stream, int statusCode, object body)
    {
        return WriteResponseAsync(
            stream,
            statusCode,
            "application/json; charset=utf-8",
            Encoding.UTF8.GetBytes(JsonSerializer.Serialize(body)),
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

    private static string GetPlanilhasFolder(string appFolder)
    {
        return Path.Combine(appFolder, "dados", "planilhas");
    }

    private static string? FindCurrentWorkbookPath(string appFolder)
    {
        var planilhasFolder = GetPlanilhasFolder(appFolder);

        if (!Directory.Exists(planilhasFolder))
        {
            return null;
        }

        return Directory
            .GetFiles(planilhasFolder, "*.xlsx")
            .Select(path => new FileInfo(path))
            .Where(file => !file.Name.StartsWith("~$", StringComparison.Ordinal))
            .OrderByDescending(file => file.LastWriteTimeUtc)
            .FirstOrDefault()
            ?.FullName;
    }

    private static string GetWorkbookMetaPath(string appFolder)
    {
        return Path.Combine(GetPlanilhasFolder(appFolder), "aprendizes.json");
    }

    private static string SanitizeXlsxFileName(string fileName, string fallback)
    {
        var safeName = Path.GetFileName(fileName);

        if (string.IsNullOrWhiteSpace(safeName))
        {
            safeName = fallback;
        }

        foreach (var invalidCharacter in Path.GetInvalidFileNameChars())
        {
            safeName = safeName.Replace(invalidCharacter, '_');
        }

        return safeName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
            ? safeName
            : $"{safeName}.xlsx";
    }

    private static string GetTimestampedWorkbookName()
    {
        return $"Aprendizes_{DateTime.Now:HHmmssddMMyy}.xlsx";
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

    private static void OpenBrowser(string url)
    {
        Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
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

    private sealed record HttpRequest(
        string Method,
        string Path,
        Dictionary<string, string> Headers,
        byte[] Body
    );
}
