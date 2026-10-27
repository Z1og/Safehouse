#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <shlobj.h>
#include <stdio.h>
#include <wchar.h>

#define PATH_CAP 4096
static WCHAR logPath[PATH_CAP];

static BOOL join(WCHAR *out, const WCHAR *base, const WCHAR *name) {
    if (wcslen(base) + wcslen(name) + 2 >= PATH_CAP) { SetLastError(ERROR_FILENAME_EXCED_RANGE); return FALSE; }
    wcscpy(out, base); if (*base && base[wcslen(base)-1] != L'\\') wcscat(out, L"\\"); wcscat(out, name); return TRUE;
}
static BOOL exists(const WCHAR *path) { return GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES; }
static BOOL mkdir(const WCHAR *path) { return CreateDirectoryW(path, NULL) || GetLastError() == ERROR_ALREADY_EXISTS; }
static BOOL writable(const WCHAR *directory) {
    WCHAR probe[PATH_CAP], name[80]; _snwprintf(name, 80, L".launch-probe-%lu", GetCurrentProcessId());
    if (!join(probe, directory, name)) return FALSE;
    HANDLE file = CreateFileW(probe, GENERIC_WRITE, FILE_SHARE_READ, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE, NULL);
    if (file == INVALID_HANDLE_VALUE) return FALSE;
    CloseHandle(file); return TRUE;
}
static BOOL cacheDirectories(const WCHAR *base, const WCHAR *name, WCHAR *home, WCHAR *versions) {
    return join(home, base, name) && mkdir(home) && writable(home)
        && join(versions, home, L"versions") && mkdir(versions) && writable(versions);
}
static void logLine(const WCHAR *text) {
    if (!*logPath) return;
    HANDLE file = CreateFileW(logPath, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return;
    char bytes[16384]; DWORD written;
    int length = WideCharToMultiByte(CP_UTF8, 0, text, -1, bytes, sizeof(bytes), NULL, NULL);
    if (length > 0) WriteFile(file, bytes, length-1, &written, NULL);
    WriteFile(file, "\r\n", 2, &written, NULL); CloseHandle(file);
}
static BOOL copyTree(const WCHAR *source, const WCHAR *destination) {
    WCHAR pattern[PATH_CAP], from[PATH_CAP], to[PATH_CAP];
    if (!mkdir(destination) || !join(pattern, source, L"*")) { DWORD error = GetLastError(); logLine(L"Cannot create destination directory:"); logLine(destination); SetLastError(error); return FALSE; }
    WIN32_FIND_DATAW entry; HANDLE search = FindFirstFileW(pattern, &entry);
    if (search == INVALID_HANDLE_VALUE) return FALSE;
    BOOL ok = TRUE;
    do {
        if (!wcscmp(entry.cFileName, L".") || !wcscmp(entry.cFileName, L"..")) continue;
        if (!join(from, source, entry.cFileName) || !join(to, destination, entry.cFileName)) { ok = FALSE; break; }
        if (entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            if (!copyTree(from, to)) { ok = FALSE; break; }
        } else if (!CopyFileW(from, to, FALSE)) { DWORD error = GetLastError(); logLine(L"Copy failed:"); logLine(from); logLine(to); SetLastError(error); ok = FALSE; break; }
    } while (FindNextFileW(search, &entry));
    DWORD error = GetLastError(); FindClose(search);
    if (!ok) SetLastError(error);
    return ok;
}
static int fail(const WCHAR *message) {
    DWORD error = GetLastError(); WCHAR system[1024] = L"", text[8192];
    FormatMessageW(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, NULL, error, 0, system, 1024, NULL);
    _snwprintf(text, 8192, L"%ls\n\nWindows error %lu: %ls\n\nLog: %ls", message, error, system, logPath);
    text[8191] = 0; logLine(text); MessageBoxW(NULL, text, L"Safehouse - launch failed", MB_ICONERROR | MB_OK); return 1;
}
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR command, int show) {
    (void)instance; (void)previous; (void)command; (void)show;
    WCHAR root[PATH_CAP], local[PATH_CAP], home[PATH_CAP], versions[PATH_CAP], buildFile[PATH_CAP], destination[PATH_CAP], marker[PATH_CAP], executable[PATH_CAP], source[PATH_CAP], stage[PATH_CAP], temporary[PATH_CAP];
    DWORD n = GetModuleFileNameW(NULL, root, PATH_CAP);
    if (!n || n >= PATH_CAP) return fail(L"Cannot read the launcher location.");
    WCHAR *slash = wcsrchr(root, L'\\'); if (!slash) return fail(L"Invalid launcher location."); *slash = 0;
    if (FAILED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA | CSIDL_FLAG_CREATE, NULL, SHGFP_TYPE_CURRENT, local))) return fail(L"Cannot locate local application data.");
    if (!cacheDirectories(local, L"Safehouse", home, versions)) {
        // Old elevated releases or restricted desktop launchers may leave the
        // application cache unwritable. Use a per-user cache; never elevate or
        // change permissions on an existing directory to make startup work.
        DWORD length = GetTempPathW(PATH_CAP, local);
        if (!length || length >= PATH_CAP || !cacheDirectories(local, L"Safehouse-runtime", home, versions)) return fail(L"Cannot create a writable per-user application cache.");
    }
    if (!join(logPath, home, L"launcher.log")) return fail(L"Application cache path is too long.");
    logLine(L"Native Win32 launcher started"); logLine(root);
    if (!join(buildFile, root, L"build-id.txt")) return fail(L"Release path is too long.");
    HANDLE build = CreateFileW(buildFile, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (build == INVALID_HANDLE_VALUE) return fail(L"Missing build-id.txt. Extract the complete release ZIP first.");
    char id[32] = {0}; DWORD count = 0; BOOL read = ReadFile(build, id, 31, &count, NULL); CloseHandle(build);
    if (!read || count < 16 || (count > 16 && id[16] != '\n' && id[16] != '\r')) { SetLastError(ERROR_INVALID_DATA); return fail(L"Invalid release build ID."); }
    WCHAR wideId[17];
    for (int i = 0; i < 16; ++i) { if (!((id[i] >= 'a' && id[i] <= 'f') || (id[i] >= '0' && id[i] <= '9'))) { SetLastError(ERROR_INVALID_DATA); return fail(L"Invalid release build ID."); } wideId[i] = id[i]; } wideId[16] = 0;
    if (!join(destination, versions, wideId)) return fail(L"Cannot create application version directory.");
    WCHAR mutexName[128]; _snwprintf(mutexName, 128, L"Local\\Safehouse-prepare-%ls", wideId);
    HANDLE mutex = CreateMutexW(NULL, FALSE, mutexName);
    if (!mutex) return fail(L"Cannot prepare launcher lock.");
    DWORD wait = WaitForSingleObject(mutex, 120000);
    if (wait != WAIT_OBJECT_0 && wait != WAIT_ABANDONED) { CloseHandle(mutex); return fail(L"Another instance is still preparing this version."); }
    join(marker, destination, L".safehouse-ready"); join(executable, destination, L"Safehouse.exe");
    if (!exists(marker) || !exists(executable)) {
        if (!join(source, root, L"app") || !join(temporary, source, L"Safehouse.exe") || !exists(temporary)) { ReleaseMutex(mutex); CloseHandle(mutex); SetLastError(ERROR_FILE_NOT_FOUND); return fail(L"Missing app/Safehouse.exe. Extract the complete ZIP before running."); }
        _snwprintf(temporary, PATH_CAP, L"%ls.preparing-%lu-%llu", wideId, GetCurrentProcessId(), GetTickCount64());
        if (!join(stage, versions, temporary) || !copyTree(source, stage)) { ReleaseMutex(mutex); CloseHandle(mutex); return fail(L"Cannot copy the application to local storage."); }
        join(temporary, stage, L".safehouse-ready"); HANDLE ready = CreateFileW(temporary, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
        DWORD written = 0; BOOL marked = ready != INVALID_HANDLE_VALUE && WriteFile(ready, id, 16, &written, NULL); if (ready != INVALID_HANDLE_VALUE) CloseHandle(ready);
        if (!marked || written != 16) { ReleaseMutex(mutex); CloseHandle(mutex); return fail(L"Cannot finalize the local application copy."); }
        if (exists(destination)) { _snwprintf(temporary, PATH_CAP, L"%ls-repair-%llu", wideId, GetTickCount64()); join(destination, versions, temporary); }
        if (!MoveFileW(stage, destination)) { ReleaseMutex(mutex); CloseHandle(mutex); return fail(L"Cannot finalize the application directory."); }
        join(executable, destination, L"Safehouse.exe");
    }
    ReleaseMutex(mutex); CloseHandle(mutex);
    SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", NULL);
    WCHAR arguments[PATH_CAP + 3]; _snwprintf(arguments, PATH_CAP + 3, L"\"%ls\"", executable);
    STARTUPINFOW startup = {0}; PROCESS_INFORMATION process = {0}; startup.cb = sizeof(startup);
    if (!CreateProcessW(executable, arguments, NULL, NULL, FALSE, CREATE_UNICODE_ENVIRONMENT, NULL, destination, &startup, &process)) return fail(L"Cannot start Safehouse.");
    logLine(L"Application process started"); logLine(executable);
    DWORD result = WaitForSingleObject(process.hProcess, 2500), exitCode = 0;
    if (result == WAIT_OBJECT_0) GetExitCodeProcess(process.hProcess, &exitCode);
    CloseHandle(process.hThread); CloseHandle(process.hProcess);
    if (result == WAIT_OBJECT_0 && exitCode != 0) { SetLastError(exitCode); return fail(L"Safehouse exited during startup."); }
    return 0;
}
