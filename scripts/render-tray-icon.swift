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
//   anchor  = (7.5, 11)        slightly left of center
//   dot     = filled circle, r=1.4pt
//   arc1    = stroked, r=4.5pt, ±55°  (1.6pt round caps)
//   arc2    = stroked, r=8pt,   ±55°  (1.6pt round caps)
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

let cx: CGFloat = 7.5
let cy: CGFloat = 11
let stroke: CGFloat = 1.6

// Source dot.
NSBezierPath(ovalIn: NSRect(x: cx - 1.4, y: cy - 1.4, width: 2.8, height: 2.8)).fill()

// Inner arc.
let inner = NSBezierPath()
inner.appendArc(withCenter: NSPoint(x: cx, y: cy), radius: 4.5, startAngle: -55, endAngle: 55)
inner.lineWidth = stroke
inner.lineCapStyle = .round
inner.stroke()

// Outer arc.
let outer = NSBezierPath()
outer.appendArc(withCenter: NSPoint(x: cx, y: cy), radius: 8, startAngle: -55, endAngle: 55)
outer.lineWidth = stroke
outer.lineCapStyle = .round
outer.stroke()

NSGraphicsContext.restoreGraphicsState()

guard let data = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
try data.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath) (\(canvasPx)x\(canvasPx))")
