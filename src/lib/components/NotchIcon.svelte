<script lang="ts">
  // Ikon Cognify Notch: kotak dengan tab hitam bermata di atas dan tiga lingkaran berwarna.
  // Warna memakai token supaya ikut tema; animasinya (tab melebar saat hover) ada di app.css.
  let { size = 16 }: { size?: number } = $props();
</script>

<svg class="lucide-icon lucide-notch" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
  <defs>
    <clipPath id="notch-icon-clip"><rect x="1" y="1" width="22" height="22" rx="6" /></clipPath>
  </defs>
  <rect x="1" y="1" width="22" height="22" rx="6" style="fill: var(--kind-doc)" />
  <g clip-path="url(#notch-icon-clip)">
    <circle cx="19.5" cy="12.5" r="3.6" style="fill: var(--cat-2)" />
    <circle cx="8.5" cy="17.5" r="7.5" style="fill: var(--kind-board)" />
    <circle cx="19" cy="21" r="5.6" style="fill: var(--kind-table)" />
    <path class="nt" d="M7.5 1h9v3.3a2.4 2.4 0 0 1-2.4 2.4H9.9a2.4 2.4 0 0 1-2.4-2.4z" style="fill: var(--text)" />
    <ellipse class="eye l" cx="10.5" cy="3.7" rx="0.55" ry="0.9" style="fill: var(--surface)" />
    <ellipse class="eye r" cx="13.5" cy="3.7" rx="0.55" ry="0.9" style="fill: var(--surface)" />
  </g>
</svg>
