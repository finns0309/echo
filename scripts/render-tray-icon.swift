// One-shot: render an SF Symbol to a template PNG for the tray icon.
// Run:  swift scripts/render-tray-icon.swift assets/tray-Template.png
// (re-run if you want to swap symbols / weights)
import AppKit

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write("usage: render-tray-icon.swift <output.png> [symbol] [pointSize]\n".data(using: .utf8)!)
    exit(2)
}
let outPath = CommandLine.arguments[1]
let symbolName = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "music.note"
let pointSize: CGFloat = CommandLine.arguments.count > 3 ? CGFloat(Double(CommandLine.arguments[3]) ?? 18) : 18

guard let base = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil) else {
    FileHandle.standardError.write("unknown SF Symbol: \(symbolName)\n".data(using: .utf8)!)
    exit(1)
}
let cfg = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .semibold)
let img = base.withSymbolConfiguration(cfg) ?? base

let scale: CGFloat = 2.0  // @2x for retina menubar
let pixelW = Int(img.size.width * scale)
let pixelH = Int(img.size.height * scale)

guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: pixelW, pixelsHigh: pixelH,
    bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0
) else { exit(1) }
bitmap.size = img.size

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor.black.set()  // template image: glyph drawn in black on transparent; macOS recolors
img.draw(in: NSRect(origin: .zero, size: img.size))
NSGraphicsContext.restoreGraphicsState()

guard let data = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
try data.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath) (\(pixelW)x\(pixelH))")
