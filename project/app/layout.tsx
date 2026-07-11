import type {Metadata, Viewport} from 'next';
import './globals.css';
import './workbench/page-styles.css';

export const metadata: Metadata = {
  title: 'xobi 图片翻译工作台',
  description: '本机批量图片翻译、文字重绘与结果归档工作台',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  themeColor: [
    {media: '(prefers-color-scheme: light)', color: '#f4f4f2'},
    {media: '(prefers-color-scheme: dark)', color: '#0b0b0b'},
  ],
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('xobi-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){document.documentElement.dataset.theme='dark'}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
