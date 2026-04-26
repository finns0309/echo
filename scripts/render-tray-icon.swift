// One-shot: render an SF Symbol to a square template PNG sized for the macOS
// menu bar.
//
//   swift scripts/render-tray-icon.swift assets/tray-Template.png [symbol] [glyphPt]
//
// macOS menu bar tray icons want a *square* image at 22pt logical (@2x = 44px),
// with the glyph itself ~14–16pt and the rest as padding. Feeding a non-square
// image makes the OS scale-to-fit-height, which is why a vertical glyph like
// `music.note` came out comically tall on the first pass.
import AppKit

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write("usage: render-tray-icon.swift <output.png> [symbol] [glyphPt]\n".data(using: .utf8)!)
    exit(2)
}
let outPath = CommandLine.arguments[1]
let symbolName = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "music.note"
let glyphPt: CGFloat = CommandLine.arguments.count > 3 ? CGFloat(Double(CommandLine.arguments[3]) ?? 14) : 14

// Canvas: 22pt square @ 2x = 44px square. Standard menubar tray slot.
let canvasPt: CGFloat = 22
let scale: CGFloat = 2.0
let canvasPx = Int(canvasPt * scale)

guard let base = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil) else {
    FileHandle.standardError.write("unknown SF Symbol: \(symbolName)\n".data(using: .utf8)!)
    exit(1)
}
let cfg = NSImage.SymbolConfiguration(pointSize: glyphPt, weight: .medium)
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
