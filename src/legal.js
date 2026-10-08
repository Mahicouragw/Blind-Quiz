// Applies the player's saved display settings (large text, high contrast, reduced motion) on the legal pages.
try{const s=JSON.parse(localStorage.getItem('bq.settings')||'{}');document.body.classList.toggle('large-text',!!s.largeText);document.body.classList.toggle('high-contrast',!!s.highContrast);document.body.classList.toggle('reduce-motion',!!s.reducedMotion)}catch{}
