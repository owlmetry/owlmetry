import Image from "next/image";

export function OwlLogo({ className, alt = "" }: { className?: string; alt?: string }) {
  return (
    <Image
      src="/owl-logo.png"
      alt={alt}
      width={128}
      height={128}
      className={className}
    />
  );
}
