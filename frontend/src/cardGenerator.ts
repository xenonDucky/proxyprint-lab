/**
 * Procedural MTG Test Card Generator for diagnostic soft-proofing benchmarks.
 */

export function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const words = text.split(' ');
  let line = '';
  let currentY = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, currentY);
  return currentY + lineHeight;
}

export function drawCardContent(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  presetId: string,
  hasBleed: boolean
): void {
  const bleedX = hasBleed ? W * (3 / 69) : 0;
  const bleedY = hasBleed ? H * (3 / 94) : 0;
  const trimW = W - bleedX * 2;
  const trimH = H - bleedY * 2;

  ctx.fillStyle = '#070709';
  ctx.fillRect(0, 0, W, H);

  const borderT = trimW * 0.048;
  const frameX = bleedX + borderT;
  const frameY = bleedY + borderT;
  const frameW = trimW - borderT * 2;
  const frameH = trimH - borderT * 2;

  const themes: Record<string, any> = {
    abyssal_dragon: {
      frameGrad: ['#1e1b24', '#121017', '#261822'],
      pinline: '#6b21a8',
      titleBg: '#27232f',
      textBg: '#1c1922',
      textColor: '#e2e8f0',
      title: 'Vorath, Abyssal Dreadwing',
      cost: ['4', 'B', 'B'],
      type: 'Legendary Creature — Elder Dragon',
      rules: [
        'Flying, deathtouch',
        'Whenever Vorath attacks, defending player sacrifices a creature inside the cavernous shadows.',
        '"In the lightless depths below Urborg, even dragonfire freezes into obsidian."'
      ],
      pt: '6/6'
    },
    aetherstorm_surge: {
      frameGrad: ['#083344', '#1e1b4b', '#4a044e'],
      pinline: '#00f5d4',
      titleBg: '#0f2942',
      textBg: '#0c1e33',
      textColor: '#ecfeff',
      title: 'Aetherstorm Hyperflux',
      cost: ['2', 'U', 'R'],
      type: 'Instant — Arcane Overload',
      rules: [
        'Copy target instant or sorcery spell twice. You may choose new targets for the copies.',
        'Draw two cards, then discard a card at random.',
        '"Raw prismatic aether burns brighter than paper or ink can ever contain."'
      ],
      pt: null
    },
    blurry_upscale: {
      frameGrad: ['#3f3324', '#292118', '#443727'],
      pinline: '#d97706',
      titleBg: '#dfd5c6',
      textBg: '#e7dfd3',
      textColor: '#1c1917',
      title: 'Gilded Lotus Reliquary',
      cost: ['5'],
      type: 'Artifact — Mythic Relic',
      rules: [
        '{T}: Add three mana of any one color.',
        'Sacrifice Gilded Lotus Reliquary: Return target historic card from your graveyard to your hand.',
        '"Downloaded from a low-res spoiler gallery and stretched to fit."'
      ],
      pt: null
    },
    sunlit_sanctuary: {
      frameGrad: ['#2d4a34', '#1b3322', '#3d5a3b'],
      pinline: '#eab308',
      titleBg: '#e2e8dd',
      textBg: '#ecf2e8',
      textColor: '#142618',
      title: 'Sunlit Canopy Sanctuary',
      cost: ['1', 'G', 'W'],
      type: 'Enchantment — Aura Sanctuary',
      rules: [
        'Creatures you control have vigilance and "+1/+1 as long as you control an enchanted land."',
        'When Sunlit Canopy Sanctuary enters, you gain 4 life and draw a card.',
        '"Crisp brushwork, balanced midtones, and well-separated shadow foliage."'
      ],
      pt: null
    }
  };

  const theme = themes[presetId] || themes.sunlit_sanctuary;

  const fGrad = ctx.createLinearGradient(frameX, frameY, frameX + frameW, frameY + frameH);
  fGrad.addColorStop(0, theme.frameGrad[0]);
  fGrad.addColorStop(0.5, theme.frameGrad[1]);
  fGrad.addColorStop(1, theme.frameGrad[2]);
  ctx.fillStyle = fGrad;
  ctx.beginPath();
  ctx.roundRect(frameX, frameY, frameW, frameH, trimW * 0.03);
  ctx.fill();

  ctx.strokeStyle = theme.pinline;
  ctx.lineWidth = Math.max(1.5, trimW * 0.005);
  ctx.stroke();

  const artX = bleedX + trimW * 0.078;
  const artY = bleedY + trimH * 0.112;
  const artW = trimW * 0.844;
  const artH = trimH * 0.435;

  ctx.save();
  ctx.beginPath();
  ctx.rect(artX, artY, artW, artH);
  ctx.clip();

  if (presetId === 'abyssal_dragon') {
    const bgGrad = ctx.createRadialGradient(
      artX + artW * 0.5,
      artY + artH * 0.42,
      artW * 0.05,
      artX + artW * 0.5,
      artY + artH * 0.5,
      artW * 0.75
    );
    bgGrad.addColorStop(0, '#1f1928');
    bgGrad.addColorStop(0.45, '#120f18');
    bgGrad.addColorStop(1, '#08060c');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(artX, artY, artW, artH);

    for (let i = 0; i < 28; i++) {
      const rx = artX + (i / 28) * artW;
      const rw = artW * 0.05;
      const rh = artH * (0.25 + 0.35 * Math.sin(i * 1.7));
      ctx.fillStyle = i % 2 === 0 ? '#15111c' : '#0d0b12';
      ctx.beginPath();
      ctx.moveTo(rx, artY);
      ctx.lineTo(rx + rw, artY);
      ctx.lineTo(rx + rw * 0.5, artY + rh);
      ctx.fill();
    }

    ctx.fillStyle = '#181320';
    ctx.strokeStyle = '#271f33';
    ctx.lineWidth = Math.max(1.5, artW * 0.004);

    ctx.beginPath();
    ctx.moveTo(artX + artW * 0.5, artY + artH * 0.55);
    ctx.quadraticCurveTo(artX + artW * 0.22, artY + artH * 0.12, artX + artW * 0.04, artY + artH * 0.42);
    ctx.quadraticCurveTo(artX + artW * 0.25, artY + artH * 0.65, artX + artW * 0.45, artY + artH * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(artX + artW * 0.5, artY + artH * 0.55);
    ctx.quadraticCurveTo(artX + artW * 0.78, artY + artH * 0.12, artX + artW * 0.96, artY + artH * 0.42);
    ctx.quadraticCurveTo(artX + artW * 0.75, artY + artH * 0.65, artX + artW * 0.55, artY + artH * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 16; col++) {
        const sx = artX + artW * (0.15 + (col / 16) * 0.7);
        const sy = artY + artH * (0.28 + (row / 12) * 0.58);
        const dist = Math.hypot(sx - (artX + artW * 0.5), sy - (artY + artH * 0.55));
        if (dist < artW * 0.34) {
          ctx.fillStyle = (row + col) % 2 === 0 ? '#1d1726' : '#14101b';
          ctx.beginPath();
          ctx.arc(sx, sy, artW * 0.022, 0, Math.PI, false);
          ctx.fill();
          ctx.strokeStyle = '#251e30';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    ctx.fillStyle = '#231b2e';
    ctx.beginPath();
    ctx.moveTo(artX + artW * 0.43, artY + artH * 0.35);
    ctx.lineTo(artX + artW * 0.57, artY + artH * 0.35);
    ctx.lineTo(artX + artW * 0.53, artY + artH * 0.52);
    ctx.lineTo(artX + artW * 0.47, artY + artH * 0.52);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#c084fc';
    ctx.beginPath();
    ctx.arc(artX + artW * 0.475, artY + artH * 0.42, artW * 0.011, 0, Math.PI * 2);
    ctx.arc(artX + artW * 0.525, artY + artH * 0.42, artW * 0.011, 0, Math.PI * 2);
    ctx.fill();
  } else if (presetId === 'aetherstorm_surge') {
    const bg = ctx.createLinearGradient(artX, artY, artX + artW, artY + artH);
    bg.addColorStop(0, '#020617');
    bg.addColorStop(0.35, '#1d046e');
    bg.addColorStop(0.7, '#004dff');
    bg.addColorStop(1, '#3b0764');
    ctx.fillStyle = bg;
    ctx.fillRect(artX, artY, artW, artH);

    for (let i = 0; i < 18; i++) {
      const radius = artW * (0.06 + i * 0.028);
      ctx.strokeStyle = i % 3 === 0 ? '#00ffff' : i % 3 === 1 ? '#ff00ff' : '#00ff66';
      ctx.lineWidth = artW * 0.014;
      ctx.beginPath();
      ctx.arc(
        artX + artW * 0.5 + Math.sin(i) * artW * 0.04,
        artY + artH * 0.48 + Math.cos(i) * artH * 0.04,
        radius,
        i * 0.4,
        i * 0.4 + Math.PI * 1.35
      );
      ctx.stroke();
    }

    ctx.strokeStyle = '#e0ffff';
    ctx.lineWidth = Math.max(2, artW * 0.006);
    for (let b = 0; b < 8; b++) {
      let lx = artX + artW * 0.5;
      let ly = artY + artH * 0.48;
      const angle = (b / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      for (let seg = 1; seg <= 6; seg++) {
        lx += Math.cos(angle + (seg % 2 === 0 ? 0.25 : -0.25)) * (artW * 0.08);
        ly += Math.sin(angle + (seg % 2 === 0 ? -0.25 : 0.25)) * (artH * 0.08);
        ctx.lineTo(lx, ly);
      }
      ctx.stroke();
    }
  } else {
    const sky = ctx.createLinearGradient(artX, artY, artX, artY + artH);
    sky.addColorStop(0, presetId === 'blurry_upscale' ? '#4f6d7a' : '#38bdf8');
    sky.addColorStop(0.55, '#fde68a');
    sky.addColorStop(1, '#14532d');
    ctx.fillStyle = sky;
    ctx.fillRect(artX, artY, artW, artH);

    ctx.fillStyle = 'rgba(254, 249, 195, 0.35)';
    ctx.beginPath();
    ctx.arc(artX + artW * 0.5, artY + artH * 0.28, artW * 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(artX, artY + artH * 0.65);
    ctx.lineTo(artX + artW * 0.22, artY + artH * 0.36);
    ctx.lineTo(artX + artW * 0.42, artY + artH * 0.55);
    ctx.lineTo(artX + artW * 0.72, artY + artH * 0.30);
    ctx.lineTo(artX + artW, artY + artH * 0.62);
    ctx.lineTo(artX + artW, artY + artH);
    ctx.lineTo(artX, artY + artH);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#f1f5f9';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = Math.max(1.5, artW * 0.004);
    for (let c = 0; c < 5; c++) {
      const cx = artX + artW * (0.22 + c * 0.13);
      const cy = artY + artH * 0.38;
      const cw = artW * 0.055;
      const ch = artH * 0.42;
      ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeRect(cx, cy, cw, ch);
      for (let f = 1; f <= 3; f++) {
        ctx.beginPath();
        ctx.moveTo(cx + (cw * f) / 4, cy);
        ctx.lineTo(cx + (cw * f) / 4, cy + ch);
        ctx.stroke();
      }
    }

    for (let leaf = 0; leaf < 45; leaf++) {
      const lx = artX + ((leaf * 37) % 100) * 0.01 * artW;
      const ly = artY + artH * (0.72 + ((leaf * 19) % 28) * 0.01);
      ctx.fillStyle = leaf % 3 === 0 ? '#166534' : leaf % 3 === 1 ? '#15803d' : '#1e3a2f';
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = Math.max(1, artW * 0.0025);
      ctx.beginPath();
      ctx.ellipse(lx, ly, artW * 0.04, artH * 0.025, (leaf % 5) * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();

  ctx.strokeStyle = theme.pinline;
  ctx.lineWidth = Math.max(2, trimW * 0.005);
  ctx.strokeRect(artX, artY, artW, artH);

  const titleX = bleedX + trimW * 0.068;
  const titleY = bleedY + trimH * 0.052;
  const titleW = trimW * 0.864;
  const titleH = trimH * 0.052;

  ctx.fillStyle = theme.titleBg;
  ctx.beginPath();
  ctx.roundRect(titleX, titleY, titleW, titleH, titleH * 0.35);
  ctx.fill();
  ctx.strokeStyle = theme.pinline;
  ctx.lineWidth = Math.max(1.5, trimW * 0.004);
  ctx.stroke();

  ctx.fillStyle = theme.textColor;
  ctx.font = `bold ${Math.round(trimH * 0.027)}px Georgia, serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(theme.title, titleX + titleW * 0.03, titleY + titleH * 0.52);

  const pipRadius = titleH * 0.33;
  theme.cost.forEach((sym: string, idx: number) => {
    const px = titleX + titleW - (theme.cost.length - idx) * (pipRadius * 2.35) - titleW * 0.015;
    const py = titleY + titleH * 0.5;
    ctx.fillStyle =
      sym === 'B'
        ? '#a855f7'
        : sym === 'U'
        ? '#38bdf8'
        : sym === 'R'
        ? '#f87171'
        : sym === 'G'
        ? '#4ade80'
        : sym === 'W'
        ? '#fef08a'
        : '#cbd5e1';
    ctx.beginPath();
    ctx.arc(px, py, pipRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = `bold ${Math.round(pipRadius * 1.25)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(sym, px, py + 1);
    ctx.textAlign = 'left';
  });

  const typeX = titleX;
  const typeY = bleedY + trimH * 0.556;
  const typeW = titleW;
  const typeH = trimH * 0.048;

  ctx.fillStyle = theme.titleBg;
  ctx.beginPath();
  ctx.roundRect(typeX, typeY, typeW, typeH, typeH * 0.35);
  ctx.fill();
  ctx.strokeStyle = theme.pinline;
  ctx.stroke();

  ctx.fillStyle = theme.textColor;
  ctx.font = `bold ${Math.round(trimH * 0.023)}px Georgia, serif`;
  ctx.fillText(theme.type, typeX + typeW * 0.03, typeY + typeH * 0.53);

  const rulesX = artX;
  const rulesY = bleedY + trimH * 0.614;
  const rulesW = artW;
  const rulesH = trimH * 0.275;

  ctx.fillStyle = theme.textBg;
  ctx.fillRect(rulesX, rulesY, rulesW, rulesH);
  ctx.strokeStyle = theme.pinline;
  ctx.strokeRect(rulesX, rulesY, rulesW, rulesH);

  ctx.fillStyle = theme.textColor;
  const fontSize = Math.round(trimH * 0.0215);
  let curY = rulesY + rulesH * 0.16;
  theme.rules.forEach((line: string, idx: number) => {
    const isFlavor = idx === theme.rules.length - 1;
    ctx.font = `${isFlavor ? 'italic' : 'normal'} ${fontSize}px Georgia, serif`;
    curY = wrapCanvasText(ctx, line, rulesX + rulesW * 0.04, curY, rulesW * 0.92, fontSize * 1.32);
    curY += fontSize * 0.45;
  });

  if (theme.pt) {
    const ptW = trimW * 0.16;
    const ptH = trimH * 0.048;
    const ptX = bleedX + trimW * 0.77;
    const ptY = bleedY + trimH * 0.865;
    ctx.fillStyle = theme.titleBg;
    ctx.beginPath();
    ctx.roundRect(ptX, ptY, ptW, ptH, ptH * 0.35);
    ctx.fill();
    ctx.strokeStyle = theme.pinline;
    ctx.lineWidth = Math.max(2, trimW * 0.005);
    ctx.stroke();

    ctx.fillStyle = theme.textColor;
    ctx.font = `bold ${Math.round(trimH * 0.026)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.fillText(theme.pt, ptX + ptW * 0.5, ptY + ptH * 0.54);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = '#94a3b8';
  ctx.font = `${Math.round(trimH * 0.015)}px sans-serif`;
  ctx.fillText(
    'PROXYPRINT LAB CALIBRATION • NOT FOR SALE',
    bleedX + trimW * 0.08,
    bleedY + trimH * 0.935
  );
}

export function generatePresetCardCanvas(presetId: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');

  if (presetId === 'blurry_upscale') {
    canvas.width = 744;
    canvas.height = 1039;
    const lowCanvas = document.createElement('canvas');
    lowCanvas.width = 248;
    lowCanvas.height = 346;
    drawCardContent(lowCanvas.getContext('2d')!, 248, 346, presetId, false);

    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(lowCanvas, 0, 0, 744, 1039);
    return canvas;
  }

  canvas.width = 816;
  canvas.height = 1110;
  const ctx = canvas.getContext('2d')!;
  drawCardContent(ctx, 816, 1110, presetId, true);
  return canvas;
}
