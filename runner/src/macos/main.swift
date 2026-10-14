// The macOS game runner. Shows Contents/Resources/game.html (the exported game) in a window, with the system's
// WebKit. With PXL_SELFTEST=<file> set, it checks that the game started, writes what it found to that file and
// quits (for the build's own test).
import Cocoa
import WebKit

let selftestJS = """
(function(){var t=Date.now();var iv=setInterval(function(){
var c=document.querySelector('[data-testid="play-canvas"]');
var ok=!!(c&&c.dataset.pixels&&c.dataset.camera);
if(ok||Date.now()-t>20000){clearInterval(iv);
window.webkit.messageHandlers.pxlSelftest.postMessage((ok?'ok':'fail')+' title='+document.title+' pixels='+(c?c.dataset.pixels:'')+' player='+(c&&c.dataset.player||''));}
},250);})();
"""

/// The game's name: the page's <title>.
func titleOf(_ html: String) -> String {
  guard let a = html.range(of: "<title>"), let b = html.range(of: "</title>", range: a.upperBound..<html.endIndex) else { return "Game" }
  let t = String(html[a.upperBound..<b.lowerBound])
    .replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
    .replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&amp;", with: "&")
  return t.isEmpty ? "Game" : t
}

final class Runner: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
  var window: NSWindow!
  var web: WKWebView!
  let selftest = ProcessInfo.processInfo.environment["PXL_SELFTEST"]

  func applicationDidFinishLaunching(_ note: Notification) {
    let resources = Bundle.main.resourceURL!
    let game = resources.appendingPathComponent("game.html")
    let title = titleOf((try? String(contentsOf: game, encoding: .utf8)) ?? "")
    let config = WKWebViewConfiguration()
    config.mediaTypesRequiringUserActionForPlayback = []
    if selftest != nil {
      config.userContentController.add(self, name: "pxlSelftest")
      config.userContentController.addUserScript(WKUserScript(source: selftestJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: config)
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = title
    window.contentView = web
    window.collectionBehavior = [.fullScreenPrimary]
    window.center()
    window.setFrameAutosaveName("PXLGame \(title)")
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(web)
    NSApp.mainMenu = menu(title)
    NSApp.activate(ignoringOtherApps: true)
    web.loadFileURL(game, allowingReadAccessTo: resources)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    if let path = selftest { try? "\(message.body)".write(toFile: path, atomically: true, encoding: .utf8) }
    NSApp.terminate(nil)
  }

  /// The app menu (Quit) and View → Full Screen.
  func menu(_ title: String) -> NSMenu {
    let bar = NSMenu()
    let appItem = NSMenuItem()
    bar.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Hide \(title)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Quit \(title)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    let viewItem = NSMenuItem()
    bar.addItem(viewItem)
    let viewMenu = NSMenu(title: "View")
    let full = NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    full.keyEquivalentModifierMask = [.command, .control]
    viewMenu.addItem(full)
    viewItem.submenu = viewMenu
    return bar
  }
}

let app = NSApplication.shared
let runner = Runner()
app.delegate = runner
app.setActivationPolicy(.regular)
app.run()
