"use client";

import { useState, useEffect } from "react";

export function useAuthCta() {
	const [isAuthenticated, setIsAuthenticated] = useState(false);

	useEffect(() => {
		setIsAuthenticated(document.cookie.includes("token="));
	}, []);

	return {
		href: isAuthenticated ? "/dashboard" : "/login",
		label: isAuthenticated ? "Dashboard" : "Get Started",
	};
}
