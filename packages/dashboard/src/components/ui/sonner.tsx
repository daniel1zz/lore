import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/lib/theme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// reason: exactOptionalPropertyTypes requires we NOT pass `theme` in both the explicit prop and
// the spread. We destructure `theme` from props so it never appears in `...rest`, then
// prefer the caller-supplied theme over the app theme. SPEC-015 §3.3 M2.
function Toaster({ theme: propTheme, ...rest }: ToasterProps): React.ReactElement {
  const { theme: appTheme = "system" } = useTheme();
  // reason: ToasterProps["theme"] is optional so could be undefined; we need the non-nullable
  // literal union to satisfy exactOptionalPropertyTypes when passing to Sonner. SPEC-015 §3.3 M2.
  const resolvedTheme = (propTheme ?? appTheme) as "light" | "dark" | "system";

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...rest}
    />
  );
}

export { Toaster };
