import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: '图片翻译器',
  description: '批量图片翻译、去水印与重绘工具',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="zh-CN">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
