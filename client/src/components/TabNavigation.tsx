import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  path: string;
}

interface TabNavigationProps {
  tabs: Tab[];
}

export default function TabNavigation({ tabs }: TabNavigationProps) {
  const [location] = useLocation();

  return (
    <div className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="flex items-center h-14 px-6">
        <nav className="flex gap-1">
          {tabs.map((tab) => {
            const isActive = location === tab.path;
            return (
              <Link key={tab.id} href={tab.path}>
                <button
                  data-testid={`tab-${tab.id}`}
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition-colors relative",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover-elevate"
                  )}
                >
                  {tab.label}
                  {isActive && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                  )}
                </button>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
