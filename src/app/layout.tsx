/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { UiLanguageProvider, UiLanguageSelector } from "@/components/UiLanguage";

export const metadata: Metadata = {
  title: "Live-Übersetzung",
  description:
    "Predigt live übersetzen: Besucher wählen ihre Sprache und hören in Echtzeit mit.",
};

export const viewport: Viewport = {
  themeColor: "#0f1825",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body><UiLanguageProvider><div style={{ position: "absolute", top: 12, right: 20, zIndex: 10 }}><UiLanguageSelector /></div>{children}</UiLanguageProvider></body>
    </html>
  );
}
