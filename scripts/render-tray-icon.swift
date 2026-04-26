// One-shot: draw echo's tray mark (eighth note ♪) to the @1x + @2x template
// PNGs that Electron's nativeImage expects on macOS.
//
//   swift scripts/render-tray-icon.swift assets/trayTemplate.png
//
// Writes two files in lock-step:
//   - assets/trayTemplate.png      (16×16 px,  @1x)
//   - assets/trayTemplate@2x.png   (32×32 px,  @2x)
//
// Filename + structure conventions established by caprine / Mailspring /
// Electron docs:
//   - 16pt logical (NOT 22pt — that's the menu bar bar height, not the icon)
//   - Always ship both @1x and @2x; Electron uses the filename suffix as
//     the only DPI signal (PNG metadata is ignored)
//   - Filename ends in `Template` (no hyphen) so macOS auto-inverts in dark
//
// Geometry — designed on 16pt canvas, glyph occupies ~75% (≈ 12pt high) to
// match the visual weight of system menu bar items:
//   notehead = rotated filled ellipse at (5, 4.25), 3.4×2.4pt, -22°
//   stem     = vertical line from (6.5, 4.25) to (6.5, 14), stroke 1.0pt
//   flag     = cubic bezier curving from stem top down-right, stroke 1.0pt
import AppKit

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write("usage: render-tray-icon.swift <output@1x.png>\n".data(using: .utf8)!)
    exit(2)
}
let basePath = CommandLine.arguments[1]
guard basePath.hasSuffix(".png") else {
    FileHandle.standardError.write("output path must end in .png\n".data(using: .utf8)!)
    exit(2)
}
let twoXPath = String(basePath.dropLast(4)) + "@2x.png"

func render(toPath outPath: String, scale: CGFloat) {
    let canvasPt: CGFloat = 16
    let canvasPx = Int(canvasPt * scale)

    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: canvasPx, pixelsHigh: canvasPx,
        bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0
    ) else { fatalError("bitmap alloc failed") }
    bitmap.size = NSSize(width: canvasPt, height: canvasPt)

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let ctx = NSGraphicsContext.current!.cgContext
    ctx.setShouldAntialias(true)
    ctx.setAllowsAntialiasing(true)
    NSColor.black.set()

    let stroke: CGFloat = 1.0

    // Stem
    let stem = NSBezierPath()
    stem.move(to: NSPoint(x: 6.5, y: 4.25))
    stem.line(to: NSPoint(x: 6.5, y: 14))
    stem.lineWidth = stroke
    stem.lineCapStyle = .round
    stem.stroke()

    // Flag — cubic bezier curving down-right from stem tip, like a single
    // eighth-note flag. Control points pulled to give the curve a natural
    // S-ish flow rather than a flat sweep.
    let flag = NSBezierPath()
    flag.move(to: NSPoint(x: 6.5, y: 14))
    flag.curve(to: NSPoint(x: 10.5, y: 9.5),
               controlPoint1: NSPoint(x: 9.5, y: 14.0),
               controlPoint2: NSPoint(x: 11.0, y: 12.0))
    flag.lineWidth = stroke
    flag.lineCapStyle = .round
    flag.stroke()

    // Notehead — filled ellipse, slanted like a real notehead (not a flat oval).
    // Drawn in a rotated coordinate system so the slant is in the glyph itself,
    // not faked with a stretched ellipse.
    NSGraphicsContext.current!.saveGraphicsState()
    let xform = NSAffineTransform()
    xform.translateX(by: 5.0, yBy: 4.25)
    xform.rotate(byDegrees: -22)
    xform.concat()
    NSBezierPath(ovalIn: NSRect(x: -1.7, y: -1.2, width: 3.4, height: 2.4)).fill()
    NSGraphicsContext.current!.restoreGraphicsState()

    NSGraphicsContext.restoreGraphicsState()

    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("png encode failed")
    }
    try! data.write(to: URL(fileURLWithPath: outPath))
    print("wrote \(outPath) (\(canvasPx)x\(canvasPx))")
}

render(toPath: basePath, scale: 1)
render(toPath: twoXPath, scale: 2)
