import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "wouter";

interface TabItem {
  id: string;
  label: string;
  path: string;
}

interface DropdownTab {
  id: string;
  label: string;
  items: TabItem[];
}

type Tab = TabItem | DropdownTab;

interface TabNavigationProps {
  tabs: Tab[];
}

function isDropdown(tab: Tab): tab is DropdownTab {
  return 'items' in tab;
}

export default function TabNavigation({ tabs }: TabNavigationProps) {
  const [location, navigate] = useLocation();

  return (
    <div className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="flex items-center justify-center h-14 px-6">
        <nav className="flex gap-1">
          {tabs.map((tab) => {
            if (isDropdown(tab)) {
              const isActive = tab.items.some(item => location === item.path);
              
              return (
                <DropdownMenu key={tab.id}>
                  <DropdownMenuTrigger asChild>
                    <button
                      data-testid={`tab-${tab.id}`}
                      className={cn(
                        "px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-1",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground hover-elevate"
                      )}
                    >
                      {tab.label}
                      <ChevronDown className="h-3 w-3" />
                      {isActive && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {tab.items.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        data-testid={`dropdown-${item.id}`}
                        className={cn(
                          "cursor-pointer",
                          location === item.path && "bg-accent"
                        )}
                        onSelect={() => navigate(item.path)}
                      >
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }

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
