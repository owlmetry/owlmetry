import Image from "next/image";

export function OwlLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/owl-logo.png"
      alt="OwlMetry"
      width={128}
      height={128}
      className={className}
    />
  );
}
