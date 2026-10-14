// The Windows game runner. Shows game.html (the exported game, next to this exe) in a window, with the
// WebView2 runtime that comes with Windows 10 and 11. With PXL_SELFTEST=<file> set, it checks that the game
// started, writes what it found to that file and quits (for the build's own test).
#include "webview/webview.h"
#include <windows.h>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

static std::wstring exeDir() {
  wchar_t buf[MAX_PATH * 4];
  DWORD n = GetModuleFileNameW(nullptr, buf, (DWORD)(sizeof(buf) / sizeof(buf[0])));
  std::wstring path(buf, n);
  return path.substr(0, path.find_last_of(L"\\/"));
}

static std::string utf8(const std::wstring &w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, nullptr, nullptr);
  return s;
}

static std::wstring wide(const std::string &s) {
  if (s.empty()) return {};
  int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
  std::wstring w(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &w[0], n);
  return w;
}

/** C:\Games\Mole Mine\game.html -> file:///C:/Games/Mole%20Mine/game.html */
static std::string fileUrl(const std::wstring &path) {
  std::string p = utf8(path), out = "file:///";
  const char *hex = "0123456789ABCDEF";
  for (unsigned char c : p) {
    if (c == '\\') out += '/';
    else if (isalnum(c) || c == '/' || c == ':' || c == '-' || c == '_' || c == '.' || c == '~') out += (char)c;
    else {
      out += '%';
      out += hex[c >> 4];
      out += hex[c & 15];
    }
  }
  return out;
}

/** The game's name: the page's <title>. */
static std::string titleOf(const std::string &html) {
  size_t a = html.find("<title>"), b = html.find("</title>");
  if (a == std::string::npos || b == std::string::npos || b < a) return "Game";
  std::string t = html.substr(a + 7, b - a - 7), out;
  for (size_t i = 0; i < t.size(); i++) {
    if (t.compare(i, 5, "&amp;") == 0) { out += '&'; i += 4; }
    else if (t.compare(i, 4, "&lt;") == 0) { out += '<'; i += 3; }
    else if (t.compare(i, 4, "&gt;") == 0) { out += '>'; i += 3; }
    else if (t.compare(i, 6, "&quot;") == 0) { out += '"'; i += 5; }
    else out += t[i];
  }
  return out.empty() ? "Game" : out;
}

static const char *SELFTEST_JS =
    "(function(){var t=Date.now();var iv=setInterval(function(){"
    "var c=document.querySelector('[data-testid=\"play-canvas\"]');"
    "var ok=!!(c&&c.dataset.pixels&&c.dataset.camera);"
    "if(ok||Date.now()-t>20000){clearInterval(iv);"
    "window.pxlSelftest((ok?'ok':'fail')+' title='+document.title+' pixels='+(c?c.dataset.pixels:'')+' player='+(c&&c.dataset.player||''));}"
    "},250);})();";

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
  std::wstring dir = exeDir();
  std::wstring game = dir + L"\\game.html";
  std::ifstream in(game, std::ios::binary);
  if (!in) {
    MessageBoxW(nullptr, L"game.html is missing: keep it in the same folder as this program.", L"Game", MB_ICONERROR);
    return 1;
  }
  std::stringstream html;
  html << in.rdbuf();
  wchar_t selftest[MAX_PATH * 4];
  DWORD hasSelftest = GetEnvironmentVariableW(L"PXL_SELFTEST", selftest, (DWORD)(sizeof(selftest) / sizeof(selftest[0])));
  try {
    webview::webview w(false, nullptr);
    w.set_title(titleOf(html.str()));
    w.set_size(1280, 800, WEBVIEW_HINT_NONE);
    if (hasSelftest) {
      std::wstring out(selftest, hasSelftest);
      w.bind("pxlSelftest", [&w, out](const std::string &req) -> std::string {
        std::ofstream f(out, std::ios::binary);
        f << req;
        f.close();
        w.terminate();
        return "";
      });
      w.init(SELFTEST_JS);
    }
    w.navigate(fileUrl(game));
    w.run();
  } catch (...) {
    if (hasSelftest) {
      std::ofstream f(std::wstring(selftest, hasSelftest), std::ios::binary);
      f << "fail could not start WebView2";
    }
    int answer = MessageBoxW(nullptr,
                             L"This game needs the Microsoft Edge WebView2 Runtime, which comes with Windows 10 and 11 "
                             L"but is missing here.\n\nOpen the download page now?",
                             L"Game", MB_ICONERROR | MB_YESNO);
    if (answer == IDYES) ShellExecuteW(nullptr, L"open", L"https://go.microsoft.com/fwlink/p/?LinkId=2124703", nullptr, nullptr, SW_SHOWNORMAL);
    return 1;
  }
  return 0;
}
