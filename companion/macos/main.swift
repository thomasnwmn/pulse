import AppKit
import Foundation

final class Companion: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var process: Process?
    private var window: NSWindow!
    private var codeField: NSTextField!
    private var messageField: NSTextField!
    private var copyItem: NSMenuItem!
    private var statusLabel: NSMenuItem!
    private var pairingCode = ""
    private var output = ""
    private var errorOutput = ""
    private var quitting = false
    private let dashboard = URL(string: Bundle.main.object(forInfoDictionaryKey: "PulseDashboardURL") as? String ?? "https://pulse.thomasnewman.ca")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let applicationMenu = NSMenu()
        let applicationItem = NSMenuItem()
        let commands = NSMenu()
        addItem(commands, "Quit Pulse Companion", #selector(quit), "q")
        applicationItem.submenu = commands
        applicationMenu.addItem(applicationItem)
        NSApp.mainMenu = applicationMenu
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "waveform.path.ecg", accessibilityDescription: "Pulse Companion")
        let menu = NSMenu()
        statusLabel = NSMenuItem(title: "Pulse Companion · starting", action: nil, keyEquivalent: "")
        menu.addItem(statusLabel)
        menu.addItem(.separator())
        addItem(menu, "Open dashboard", #selector(openDashboard))
        copyItem = addItem(menu, "Copy pairing code", #selector(copyCode))
        addItem(menu, "Show pairing window", #selector(showWindow))
        addItem(menu, "Restart collector", #selector(restart))
        menu.addItem(.separator())
        addItem(menu, "Quit Pulse Companion", #selector(quit), "q")
        menu.autoenablesItems = false
        copyItem.isEnabled = false
        statusItem.menu = menu
        makeWindow()
        startCollector()
        showWindow()
    }

    @discardableResult private func addItem(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self; menu.addItem(item); return item
    }
    private func makeWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 470, height: 340), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Pulse Companion"
        window.isReleasedWhenClosed = false
        window.center()
        let title = NSTextField(labelWithString: "Your computer, connected.")
        title.font = .systemFont(ofSize: 24, weight: .semibold)
        let subtitle = NSTextField(wrappingLabelWithString: "Visit \(dashboard.absoluteString), choose Connect computer, and enter this pairing code.")
        subtitle.font = .systemFont(ofSize: 13); subtitle.textColor = .secondaryLabelColor
        codeField = NSTextField(labelWithString: "Starting collector…")
        codeField.font = .monospacedSystemFont(ofSize: 25, weight: .medium)
        codeField.isSelectable = true
        let copyButton = NSButton(title: "Copy pairing code", target: self, action: #selector(copyCode))
        copyButton.bezelStyle = .rounded
        let openButton = NSButton(title: "Open dashboard", target: self, action: #selector(openDashboard))
        openButton.bezelStyle = .rounded
        let buttons = NSStackView(views: [copyButton, openButton])
        buttons.orientation = .horizontal; buttons.spacing = 12
        messageField = NSTextField(wrappingLabelWithString: "The collector runs while this app is open. Telemetry stays on this computer; quitting the app stops collection.")
        messageField.font = .systemFont(ofSize: 12); messageField.textColor = .secondaryLabelColor
        let stack = NSStackView(views: [title, subtitle, codeField, buttons, messageField])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 26)
        ])
    }
    private func startCollector() {
        guard let executable = Bundle.main.url(forResource: "telemetryd", withExtension: nil) else { showError("The bundled collector is missing. Download the app again."); return }
        let task = Process()
        task.executableURL = executable
        task.arguments = ["--allow-origin", dashboard.absoluteString, "--exit-with-parent"]
        let stdout = Pipe(), stderr = Pipe()
        task.standardOutput = stdout; task.standardError = stderr
        task.standardInput = FileHandle.nullDevice
        output = ""; errorOutput = ""; pairingCode = ""
        copyItem.isEnabled = false
        codeField.stringValue = "Starting collector…"
        statusLabel.title = "Pulse Companion · starting"
        process = task
        stdout.fileHandleForReading.readabilityHandler = { [weak self, weak task] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            guard let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { [weak self, weak task] in
                guard let self = self, let task = task, self.process === task else { return }
                self.output += text
                if self.output.count > 8192 { self.output = String(self.output.suffix(8192)) }
                for line in self.output.components(separatedBy: "\n") where line.hasPrefix("PAIRING_CODE: ") {
                    let code = String(line.dropFirst(14)).trimmingCharacters(in: .whitespacesAndNewlines)
                    guard code.count == 12 else { continue }
                    self.pairingCode = code
                    self.codeField.stringValue = code.uppercased()
                    self.copyItem.isEnabled = true
                    self.statusLabel.title = "Pulse Companion · running"
                    self.messageField.stringValue = "The collector runs while this app is open. Telemetry stays on this computer; quitting the app stops collection."
                }
            }
        }
        stderr.fileHandleForReading.readabilityHandler = { [weak self, weak task] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            let text = String(data: data, encoding: .utf8) ?? ""
            DispatchQueue.main.async { [weak self, weak task] in
                guard let self = self, let task = task, self.process === task else { return }
                self.errorOutput = String((self.errorOutput + text).suffix(4096))
                if !text.isEmpty { self.showError(text.trimmingCharacters(in: .whitespacesAndNewlines)) }
            }
        }
        task.terminationHandler = { [weak self, weak task] _ in
            DispatchQueue.main.async { [weak self, weak task] in
                guard let self = self, let task = task, self.process === task, !self.quitting else { return }
                self.showError(self.errorOutput.isEmpty ? "The collector stopped. Choose Restart collector from the menu bar." : self.errorOutput)
            }
        }
        do { try task.run() } catch { showError("Cannot start the collector: \(error.localizedDescription)") }
    }
    private func showError(_ message: String) {
        pairingCode = ""; copyItem.isEnabled = false
        codeField.stringValue = "Collector unavailable"
        statusLabel.title = "Pulse Companion · stopped"
        messageField.stringValue = message
    }
    @objc private func copyCode() {
        guard !pairingCode.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pairingCode, forType: .string)
    }
    @objc private func openDashboard() { NSWorkspace.shared.open(dashboard) }
    @objc private func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc private func restart() {
        let old = process; process = nil
        if old?.isRunning == true { old?.terminate(); old?.waitUntilExit() }
        startCollector(); showWindow()
    }
    @objc private func quit() { NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        if process?.isRunning == true { process?.terminate(); process?.waitUntilExit() }
    }
}

let app = NSApplication.shared
let delegate = Companion()
app.delegate = delegate
app.run()
