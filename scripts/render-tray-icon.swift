// One-shot: draw echo's tray mark to the @1x + @2x template PNGs that
// Electron's nativeImage expects on macOS.
//
//   swift scripts/render-tray-icon.swift assets/trayTemplate.png
//
// Writes two files in lock-step:
//   - assets/trayTemplate.png      (16×16 px,  @1x)
//   - assets/trayTemplate@2x.png   (32×32 px,  @2x)
//
// Why both files: Electron's nativeImage uses the `@2x` filename suffix as
// the *only* DPI signal. PNG metadata (NSBitmapImageRep.size, pHYs chunk,
// etc.) is ignored. Provide a single 32×32 PNG without the suffix and
// Electron interprets it as 32pt @1x, then macOS shrinks it to fit the
// menu bar — that's why our previous single-file approach came out blurry
// and oversized.
//
// Why 16pt and not 22pt: 22pt is the macOS menu bar *bar* height; the icon
// itself is 16pt logical with built-in padding by NSStatusItem. caprine
// and Mailspring both ship 16+32. (Apple HIG and Electron docs both say so;
// we just initially conflated bar height with icon size.)
//
// Geometry — designed on 16pt canvas:
//   anchor  = (6, 8)
//   dot     = r=1.0pt filled circle
//   arc1    = r=2.5pt, ±60°, stroke 1.0pt
//   arc2    = r=4.5pt, ±60°, stroke 1.0pt
// All radii are halves of integers and stroke = 1pt → clean pixel coverage
// at @2x (radii become integer px, stroke covers exactly 2 px).
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

    let cx: CGFloat = 6
    let cy: CGFloat = 8
    let stroke: CGFloat = 1.0

    NSBezierPath(ovalIn: NSRect(x: cx - 1.0, y: cy - 1.0, width: 2.0, height: 2.0)).fill()

    let inner = NSBezierPath()
    inner.appendArc(withCenter: NSPoint(x: cx, y: cy), radius: 2.5, startAngle: -60, endAngle: 60)
    inner.lineWidth = stroke
    inner.lineCapStyle = .round
    inner.stroke()

    let outer = NSBezierPath()
    outer.appendArc(withCenter: NSPoint(x: cx, y: cy), radius: 4.5, startAngle: -60, endAngle: 60)
    outer.lineWidth = stroke
    outer.lineCapStyle = .round
    outer.stroke()

    NSGraphicsContext.restoreGraphicsState()

    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("png encode failed")
    }
    try! data.write(to: URL(fileURLWithPath: outPath))
    print("wrote \(outPath) (\(canvasPx)x\(canvasPx))")
}

render(toPath: basePath, scale: 1)
render(toPath: twoXPath, scale: 2)
