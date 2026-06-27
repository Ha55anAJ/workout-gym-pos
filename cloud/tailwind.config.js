/** Tailwind config for the cloud owner PWA.
 *  theme.extend mirrors the inline tailwind.config in the real app's
 *  public/index.html EXACTLY so the precompiled app.css is a pixel match. */
module.exports = {
  content: ['./public/index.html'],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#185fa5', hover: '#13497e', soft: '#eaf1f8' },
        ink: '#111827',
        sub: '#6b7280',
        line: '#e5e7eb',
        panel: '#f9fafb'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif']
      }
    }
  }
};
