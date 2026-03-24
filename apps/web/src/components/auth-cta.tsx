"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuthCta } from "@/hooks/use-auth-cta";

export function AuthCTA({ className, style }: { className?: string; style?: React.CSSProperties }) {
	const { href, label } = useAuthCta();

	return (
		<Link href={href} className={className} style={style}>
			{label}
			<ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
		</Link>
	);
}
