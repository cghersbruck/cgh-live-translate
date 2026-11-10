import { UiLanguageProvider } from "@/components/UiLanguage";

// Die Oberflächensprache gilt nur auf der Hörerseite.
export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return <UiLanguageProvider>{children}</UiLanguageProvider>;
}
