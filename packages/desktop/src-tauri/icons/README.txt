此目录存放应用图标文件。

需要的文件：
- 32x32.png
- 128x128.png
- 128x128@2x.png (256x256)
- icon.icns (macOS)
- icon.ico (Windows)

生成方式：准备一张 1024x1024 的 PNG 源图，然后运行：
  npx tauri icon path/to/source.png

图标会自动生成到此目录。
