// Runs against real WebKit on macOS; no React Native or JavaScript filter emulation.
import AppKit
import WebKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let configData = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let config = try JSONSerialization.jsonObject(with: configData) as! [String: Any]
let encodedRules = config["webKitRules"] as! String
let port = CommandLine.arguments[2]
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600), styleMask: [.titled], backing: .buffered, defer: false)
let webView = WKWebView(frame: window.contentView!.bounds)
window.contentView!.addSubview(webView)

func fail(_ message: String) -> Never {
    fputs("FAIL: \(message)\n", stderr)
    exit(1)
}
func wait<T>(_ body: (@escaping (T) -> Void) -> Void) -> T {
    var value: T?
    var done = false
    body { result in value = result; done = true }
    let deadline = Date().addingTimeInterval(15)
    while !done && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
    guard done, let result = value else { fail("WebKit operation timed out") }
    return result
}
let ruleList: WKContentRuleList = wait { completion in
    WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "ordo-test", encodedContentRuleList: encodedRules) { list, error in
        if let error = error { fail("Rule compilation: \(error)") }
        guard let list = list else { fail("No compiled list") }
        completion(list)
    }
}
webView.configuration.userContentController.add(ruleList)

final class Delegate: NSObject, WKNavigationDelegate {
    var done = false
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { done = true }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("Navigation: \(error)") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("Provisional navigation: \(error)") }
}
let delegate = Delegate()
webView.navigationDelegate = delegate
func finishNavigation(_ label: String) {
    let deadline = Date().addingTimeInterval(15)
    while !delegate.done && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
    if !delegate.done { fail("Load timed out for \(label)") }
}
func load(_ host: String, _ path: String = "/", reload: Bool = false) {
    delegate.done = false
    if reload { webView.reload() }
    else { webView.load(URLRequest(url: URL(string: "http://\(host):\(port)\(path)")!)) }
    finishNavigation(host)
}
func state() -> [String: Any] {
    return wait { completion in
        webView.evaluateJavaScript("({ad:!!window.fixtureAdRan,essential:!!window.fixtureEssentialRan,frame:!!document.querySelector('iframe').contentDocument.querySelector('#frame-ok'),cookie:document.cookie.includes('fixture=yes'),form:!!document.querySelector('form')})") { result, error in
            if let error = error { fail("Script: \(error)") }
            completion(result as! [String: Any])
        }
    }
}
func verify(_ label: String, ad: Bool) {
    let result = state()
    for key in ["essential", "frame", "cookie", "form"] {
        if result[key] as? Bool != true { fail("\(label): \(key) broken") }
    }
    if result["ad"] as? Bool != ad { fail("\(label): ad expected \(ad), got \(result)") }
    print("PASS: \(label)")
}
load("publisher.ordo.test")
verify("third-party ad blocked; page, cookies, forms and frames work", ad: false)
load("www.publisher.ordo.test")
verify("exact site exception allows ads", ad: true)
load("publisher.ordo.test")
verify("exception does not include sibling hostname", ad: false)
load("ads.doubleclick.net")
verify("direct first-party visit works", ad: true)
load("publisher.ordo.test")
webView.configuration.userContentController.removeAllContentRuleLists()
load("publisher.ordo.test", reload: true)
verify("disabling takes effect on current-page reload", ad: true)
webView.configuration.userContentController.add(ruleList)
load("publisher.ordo.test", reload: true)
verify("re-enabling filters again", ad: false)
load("publisher.ordo.test", "/next")
if !webView.canGoBack { fail("History lost") }
verify("navigation preserves history", ad: false)
delegate.done = false
webView.goBack()
finishNavigation("back navigation")
if webView.url?.path != "/" { fail("Back returned to the wrong document") }
verify("back navigation returns to previous page", ad: false)

delegate.done = false
let submitted: Bool = wait { completion in
    webView.evaluateJavaScript("document.querySelector('input').value='browser-test';document.querySelector('form').submit();true") { result, error in
        if let error = error { fail("Form submission: \(error)") }
        completion(result as? Bool == true)
    }
}
if !submitted { fail("Form did not submit") }
finishNavigation("form submission")
if webView.url?.path != "/next" || webView.url?.query != "q=browser-test" { fail("Form target or data lost") }
verify("form submission sends data and loads its response", ad: false)

load("publisher.ordo.test", "/redirect")
if webView.url?.host != "www.publisher.ordo.test" { fail("Redirect target lost") }
verify("site exception follows the actual redirect destination", ad: true)
print("All native WebKit checks passed")
exit(0)
