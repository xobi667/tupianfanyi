import type {Metadata} from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '图片翻译器',
  description: '批量图片翻译、文字重绘与图像处理工具',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
