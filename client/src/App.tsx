import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import TabNavigation from "@/components/TabNavigation";
import ThemeToggle from "@/components/ThemeToggle";
import TranscriptInput from "@/pages/TranscriptInput";
import ProductInsights from "@/pages/ProductInsights";
import QADatabase from "@/pages/QADatabase";
import Categories from "@/pages/Categories";
import CompanyPage from "@/pages/CompanyPage";

const tabs = [
  { id: 'input', label: 'Add Transcript', path: '/' },
  { id: 'insights', label: 'Product Insights', path: '/insights' },
  { id: 'qa', label: 'Q&A Database', path: '/qa' },
  { id: 'categories', label: 'Manage Categories', path: '/categories' },
];

function Router() {
  return (
    <Switch>
      <Route path="/" component={TranscriptInput} />
      <Route path="/insights" component={ProductInsights} />
      <Route path="/qa" component={QADatabase} />
      <Route path="/categories" component={Categories} />
      <Route path="/companies/:slug" component={CompanyPage} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-background">
          <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="container mx-auto px-6 h-16 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
                  <span className="text-primary-foreground font-semibold text-sm">L</span>
                </div>
                <div>
                  <h1 className="font-semibold text-lg">BD Transcript Analyzer</h1>
                  <p className="text-xs text-muted-foreground">Leverege</p>
                </div>
              </div>
              <ThemeToggle />
            </div>
          </header>
          
          <TabNavigation tabs={tabs} />
          
          <main className="pb-12">
            <Router />
          </main>
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
