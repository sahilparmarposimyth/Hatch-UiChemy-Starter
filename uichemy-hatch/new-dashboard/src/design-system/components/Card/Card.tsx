import { cn } from "../../lib/cn";
import s from "./Card.module.css";

export function Card({
  interactive,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return <div className={cn(s.card, interactive && s.interactive, className)} {...props} />;
}

/* NOTE: destructure `className` out before spreading. Spreading `{...p}` after
   `className={cn(...)}` would re-apply `p.className` LAST and clobber the merged
   module class (dropping `s.header`/`s.title`/etc.) whenever a caller passes a
   className, which silently killed the header padding + title size. */
export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(s.header, className)} {...p} />
);
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn(s.title, className)} {...p} />
);
export const CardDescription = ({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn(s.desc, className)} {...p} />
);
export const CardBody = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(s.body, className)} {...p} />
);
export const CardFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(s.footer, className)} {...p} />
);
