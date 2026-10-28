# ProxyPrint Lab — MTG & TCG 6-Stage Pre-Press Soft-Proofing Studio

**ProxyPrint Lab** is a specialized web application that predicts, analyzes, and corrects print-quality issues for custom Trading Card Game (TCG) and Magic: The Gathering (MTG) proxies before printing on commercial cardstock (MakePlayingCards S30/S33, PrintingProxies) or home inkjet setups.

---

## 1. Core Architecture & Tech Stack

The architecture is split to prevent UI lag during live image adjustments by separating heavy analysis from 60 FPS real-time rendering:

* **Frontend (`frontend/` — Live Simulator & UI):** React 19 + TypeScript + Vite + Tailwind CSS + HTML5 Canvas / 3D LUT engine.
  * Handles image uploads, diagnostic calibration presets, configuration toggles, and side-by-side comparison previews.
  * Executes the **Live Adjustment Simulator**: applies tone curves, selective shadow toe-lifts, and trilinearly interpolated **17×17×17 3D Look-Up Tables (3D LUTs)** directly in the browser at 60 FPS without server round-trips.
* **Backend (`backend/` — Heavy Analysis API):** Python (FastAPI) + OpenCV + Pillow + NumPy.
  * Handles full-resolution **2D Fast Fourier Transform (FFT)** & **Laplacian edge variance** sharpness checks, **CIELAB** conversions, **11×11 sliding-window local standard deviation**, and **$\Delta E_{2000}$** soft-proofing.
  * Returns baseline scores, a downscaled working image for the frontend simulator, and the printer 3D LUT.
  * Includes a seamless client-side fallback engine so the frontend also operates standalone with zero latency.

---

## 2. The 6-Stage Analysis Pipeline

1. **Stage 1 — Preparation & MTG Geometry Masking:**
   * **Bleed Check:** Verifies if the image contains the required 3mm bleed margin ($816 \times 1110\text{ px}$ for a 300 PPI standard card).
   * **Mode Selection (Full Card vs. Art Crop):** Automatically masks out standard TCG black borders and text boxes so intentional black design elements don't trigger false shadow-crush warnings.
2. **Stage 2 — Resolution & Sharpness (Anti-Upscale):**
   * Calculates nominal PPI based on physical trim size.
   * Applies a **Laplacian edge gradient + 2D FFT high-frequency energy check** to detect "fake" resolution (e.g., a low-res image scaled up in Photoshop, which has high pixels but low actual sharpness).
3. **Stage 3 — Shadow Detail Retention (The Critical Metric):**
   * Converts the unmasked art to **CIELAB** space.
   * Measures the percentage of pixels in the crush zone ($L^* < 15$).
   * Computes local standard deviation within an **$11\times11$ sliding window** in dark areas to distinguish between a muddy, detail-less swamp (low gradient) and a crisp night scene (high gradient).
4. **Stage 4 — Local Contrast:**
   * Uses a **CLAHE-style $8\times8$ grid** to compute local RMS contrast, ensuring midtones and highlights have sufficient separation from their backgrounds.
5. **Stage 5 — Color Gamut & Output Simulation:**
   * Uses **Synthetic Built-in Profiles**: *Commercial Cardstock (MPC S30/S33)*, *Home Inkjet (Matte)*, and *Home Inkjet (Glossy)*.
   * Calculates pixel-wise **$\Delta E_{2000}$** between the original sRGB file and the soft-proofed output to flag out-of-gamut colors (neon greens, cyans, magentas, deep blues).
6. **Stage 6 — Bottleneck Scoring Algorithm:**
   * Uses the non-linear scoring formula:
     $$Q_{\text{final}} = \min\left(Q_{\text{weighted}}, \min(R, S, C) + 15\right)$$
   * Ensures that a fatal flaw in one category (e.g., 0/100 shadow detail) forces an overall failing score, even if resolution and contrast are 100/100.

---

## 3. Running the Project

### Frontend (Vite + React + 60 FPS 3D-LUT Studio)
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

### Backend (FastAPI + OpenCV + Pillow Heavy Analysis API)
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
API documentation is automatically available at `http://localhost:8000/docs`.
