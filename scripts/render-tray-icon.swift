// One-shot: draw echo's tray mark to a template PNG.
//
//   swift scripts/render-tray-icon.swift assets/tray-Template.png
//
// Why hand-drawn instead of an SF Symbol:
//
// SF Symbols look great in NSStatusItem when the OS rasterizes them live (it
// applies CoreText optical sizing + hinting at display time). When we
// pre-rasterize via lockFocus / NSGraphicsContext to feed Electron's Tray
// constructor, we lose all of that — the result reads as "blurry SF Symbol".
//
// Pure CG paths drawn at the target pixel grid stay crisp at 22pt because
// there's no hinting to lose. The mark below is a simple "dot + two
// concentric arcs" — a broadcasting / radiating metaphor that fits the
// project name (echo = the sound coming back).
//
// Pixel layout, 22pt canvas (@2x = 44px):
//   anchor  = (8.5, 11)        slightly left of center
//   dot     = filled circle, r=1.0pt
//   arc1    = stroked, r=3pt,   ±60°  (1.3pt round caps)
//   arc2    = stroked, r=5.5pt, ±60°  (1.3pt round caps)
//
// Sizing note: the canvas is 22pt but the glyph itself sits inside an inner
// ~12pt box, leaving ~5pt padding top and bottom. This matches what system
// menu bar items (Wi-Fi / Bluetooth / volume) actually draw — the HIG says
// "22pt template image" but is silent on how much of those 22pt the glyph
// should occupy. Filling the canvas makes us look ~30% larger than peers.
import AppKit

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write("usage: render-tray-icon.swift <output.png>\n".data(using: .utf8)!)
    exit(2)
}
let outPath = CommandLine.arguments[1]

let canvasPt: CGFloat = 22
let scale: CGFloat = 2
let canvasPx = Int(canvasPt * scale)

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

let ctx = NSGraphicsContext.current!.cgContext
ctx.setShouldAntialias(true)
ctx.setAllowsAntialiasing(true)

// Template image: black-on-clear; macOS recolors per dark/light.
NSColor.black.set()

let cx: CGFloat = 8.5
let cy: CGFloat = 11
let stroke: CGFloat = 1.3

// Source dot.
NSBezierPath(ovalIn: NSRect(x: cx - 1.0, y: cy - 1.0, width: 2.0, height: 2.0)).fill()

// Inner arc.
let inner = NSBezierPath()
inner.appendArc(withCenter: NSPoint(x: cx, y: cy), radius: 3, startAngle: -60, endAngle: 60)
inner.lineWidth = stroke
inner.lineCapStyle = .round
inner.stroke()

// Outer arc.
let outer = NSBezierPath()
outer.appendArc(withCenter: NSPoint(x: cx, y: cy), radius: 5.5, startAngle: -60, endAngle: 60)
outer.lineWidth = stroke
outer.lineCapStyle = .round
outer.stroke()

NSGraphicsContext.restoreGraphicsState()

guard let data = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
try data.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath) (\(canvasPx)x\(canvasPx))")
