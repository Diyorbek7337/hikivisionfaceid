import './globals.css';
import AppShell from '@/components/AppShell';

export const metadata = {
  title: 'Davomat',
  description: 'Face ID davomat tizimi',
};

export default function RootLayout({ children }) {
  return (
    <html lang="uz">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
