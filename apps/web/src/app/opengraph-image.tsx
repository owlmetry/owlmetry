import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Owlmetry — Agent-first observability. Set up in one prompt.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage() {
	const logoData = await readFile(
		join(process.cwd(), "public", "owl-logo.png")
	);
	const logoSrc = `data:image/png;base64,${logoData.toString("base64")}`;

	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					background: "#1a1510",
					position: "relative",
				}}
			>
				{/* Subtle radial glow */}
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						display: "flex",
						background:
							"radial-gradient(ellipse at 50% 40%, rgba(190, 120, 20, 0.15) 0%, transparent 60%)",
					}}
				/>

				{/* Top accent line */}
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						height: 4,
						display: "flex",
						background:
							"linear-gradient(90deg, transparent 10%, #c07a14 30%, #e8a020 50%, #c07a14 70%, transparent 90%)",
					}}
				/>

				{/* Logo */}
				<img
					src={logoSrc}
					width={120}
					height={106}
					style={{ marginBottom: 32 }}
				/>

				{/* Title */}
				<div
					style={{
						fontSize: 56,
						fontWeight: 700,
						color: "#ffffff",
						letterSpacing: "-1px",
						display: "flex",
					}}
				>
					Owlmetry
				</div>

				{/* Tagline */}
				<div
					style={{
						fontSize: 26,
						color: "rgba(255, 255, 255, 0.55)",
						marginTop: 16,
						display: "flex",
					}}
				>
					Agent-first observability for mobile apps
				</div>

				{/* Feature pills */}
				<div
					style={{
						display: "flex",
						gap: 16,
						marginTop: 40,
					}}
				>
					{["Events", "Metrics", "Funnels", "A/B Experiments"].map(
						(label) => (
							<div
								key={label}
								style={{
									display: "flex",
									padding: "8px 20px",
									borderRadius: 100,
									border: "1px solid rgba(255, 255, 255, 0.12)",
									background: "rgba(255, 255, 255, 0.04)",
									fontSize: 16,
									color: "rgba(255, 255, 255, 0.45)",
								}}
							>
								{label}
							</div>
						)
					)}
				</div>

				{/* Bottom domain */}
				<div
					style={{
						position: "absolute",
						bottom: 32,
						display: "flex",
						fontSize: 16,
						color: "rgba(255, 255, 255, 0.25)",
						letterSpacing: "1px",
					}}
				>
					owlmetry.com
				</div>
			</div>
		),
		{ ...size }
	);
}
