import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
      size: {
        xs: "h-4 px-1.5 py-0 text-[10px] [&>svg]:size-2.5",
        sm: "h-5 px-2 text-[10px] [&>svg]:size-3",
        md: "px-2 py-0.5 text-xs [&>svg]:size-3",
        lg: "px-2.5 py-1 text-sm [&>svg]:size-3.5",
      },
      tone: {
        neutral: "",
        red: "",
        amber: "",
        green: "",
        blue: "",
        sky: "",
        gray: "",
        yellow: "",
        cyan: "",
      },
    },
    compoundVariants: [
      // Filled tones (variant=default) — solid background, white text.
      { variant: "default", tone: "red", className: "bg-red-600 text-white" },
      { variant: "default", tone: "amber", className: "bg-amber-600 text-white" },
      { variant: "default", tone: "green", className: "bg-green-600 text-white" },
      { variant: "default", tone: "blue", className: "bg-blue-600 text-white" },
      { variant: "default", tone: "sky", className: "bg-sky-600 text-white" },
      { variant: "default", tone: "gray", className: "bg-gray-600 text-white" },
      { variant: "default", tone: "yellow", className: "bg-yellow-600 text-white" },
      { variant: "default", tone: "cyan", className: "bg-cyan-600 text-white" },
      // Tinted outline tones — translucent bg + colored text + colored border.
      { variant: "outline", tone: "red", className: "border-red-500/30 bg-red-500/10 text-red-500" },
      { variant: "outline", tone: "amber", className: "border-amber-500/30 bg-amber-500/10 text-amber-500" },
      { variant: "outline", tone: "green", className: "border-green-500/30 bg-green-500/10 text-green-500" },
      { variant: "outline", tone: "blue", className: "border-blue-500/30 bg-blue-500/10 text-blue-500" },
      { variant: "outline", tone: "sky", className: "border-sky-500/30 bg-sky-500/10 text-sky-500" },
      { variant: "outline", tone: "gray", className: "border-gray-500/30 bg-gray-500/10 text-gray-400" },
      { variant: "outline", tone: "yellow", className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-500" },
      { variant: "outline", tone: "cyan", className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-500" },
    ],
    defaultVariants: {
      variant: "default",
      size: "md",
      tone: "neutral",
    },
  }
)

function Badge({
  className,
  variant = "default",
  size,
  tone,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant, size, tone }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
