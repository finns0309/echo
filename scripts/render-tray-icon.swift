// One-shot: render an SF Symbol to a square template PNG sized for the macOS
// menu bar.
//
//   swift scripts/render-tray-icon.swift assets/tray-Template.png [symbol] [glyphPt]
//
// Per Apple HIG for menu bar extras, the image canvas should be 22pt square
// (@2x = 44px). The glyph inside should be in the 13–16pt range with ~3pt
// padding so it sits visually like a peer to system items (Bluetooth / Wi-Fi /
// volume). Two pitfalls when targeting `music.note` specifically:
//   1. Glyphs with a vertical stem render *taller* than horizontally-symmetric
//      glyphs at the same pointSize — drop the pointSize to compensate.
//   2. SF Symbols default `weight: .medium` reads heavier than the regular
//      weight system uses — match `.regular` for visual parity.
import AppKit

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write("usage: render-tray-icon.swift <output.png> [symbol] [glyphPt]\n".data(using: .utf8)!)
    exit(2)
}
let outPath = CommandLine.arguments[1]
let symbolName = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "music.note"
let glyphPt: CGFloat = CommandLine.arguments.count > 3 ? CGFloat(Double(CommandLine.arguments[3]) ?? 11) : 11

// Canvas: 22pt square @ 2x = 44px square. Standard menubar tray slot.
let canvasPt: CGFloat = 22
let scale: CGFloat = 2.0
let canvasPx = Int(canvasPt * scale)

guard let base = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil) else {
    FileHandle.standardError.write("unknown SF Symbol: \(symbolName)\n".data(using: .utf8)!)
    exit(1)
}
let cfg = NSImage.SymbolConfiguration(pointSize: glyphPt, weight: .regular)
let glyph = base.withSymbolConfiguration(cfg) ?? base

guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: canvasPx, pixelsHigh: canvasPx,
    bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0
) else { exit(1) }
bitmap.size = NSSize(width: canvasPt, height: canvasPt)

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

// Center glyph inside the square canvas. Glyph dimensions come from its
// configured intrinsic size — for music.note that's ~taller-than-wide, so x
// padding > y padding.
let g = glyph.size
let originX = (canvasPt - g.width)  / 2
let originY = (canvasPt - g.height) / 2
NSColor.black.set() // template image: monochrome glyph, OS recolors per dark/light
glyph.draw(in: NSRect(x: originX, y: originY, width: g.width, height: g.height))

NSGraphicsContext.restoreGraphicsState()

guard let data = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
try data.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath) (\(canvasPx)x\(canvasPx), glyph ≈ \(Int(g.width))x\(Int(g.height))pt)")
