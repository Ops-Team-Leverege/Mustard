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
import Companies from "@/pages/Companies";
import CompanyPage from "@/pages/CompanyPage";
import CategoryPage from "@/pages/CategoryPage";
// From Replit Auth integration (blueprint:javascript_log_in_with_replit)
import { useAuth } from "@/hooks/useAuth";
import Landing from "@/pages/Landing";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import pitcrewLogo from "@assets/pitcrew_1759419966878.png";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef } from "react";

const tabs = [
  { id: 'input', label: 'Add Transcript', path: '/' },
  { id: 'insights', label: 'Product Insights', path: '/insights' },
  { id: 'qa', label: 'Q&A Database', path: '/qa' },
  { id: 'companies', label: 'Companies', path: '/companies' },
  { id: 'categories', label: 'Categories', path: '/categories' },
];

function Router() {
  const { isAuthenticated, isLoading, error } = useAuth();
  
  const isDomainRestricted = error && 
    (String(error).includes('403') || String(error).includes('DOMAIN_RESTRICTED'));

  return (
    <Switch>
      {isLoading || !isAuthenticated || isDomainRestricted ? (
        <Route path="/" component={Landing} />
      ) : (
        <>
          <Route path="/" component={TranscriptInput} />
          <Route path="/insights" component={ProductInsights} />
          <Route path="/qa" component={QADatabase} />
          <Route path="/companies" component={Companies} />
          <Route path="/companies/:slug" component={CompanyPage} />
          <Route path="/categories" component={Categories} />
          <Route path="/categories/:id" component={CategoryPage} />
        </>
      )}
    </Switch>
  );
}

function AuthenticatedApp() {
  const { isAuthenticated, isLoading, error } = useAuth();
  const { toast } = useToast();
  const hasShownError = useRef(false);

  useEffect(() => {
    if (error && !hasShownError.current) {
      const errorMessage = (error as any)?.message || String(error);
      
      if (errorMessage.includes('403') || errorMessage.includes('DOMAIN_RESTRICTED')) {
        hasShownError.current = true;
        
        queryClient.clear();
        
        toast({
          title: "Access Denied",
          description: "Only leverege.com email addresses are allowed to access this application.",
          variant: "destructive",
        });
        
        setTimeout(() => {
          window.location.href = '/api/logout';
        }, 2000);
      }
    }
  }, [error, toast]);

  return (
    <div className="min-h-screen bg-background">
      {!isLoading && isAuthenticated && (
        <>
          <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="container mx-auto px-6 h-16 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img src={pitcrewLogo} alt="PitCrew Logo" className="h-8 w-8 rounded-md" />
                <div>
                  <h1 className="font-semibold text-lg">PitCrew Customer Transcript Analyzer</h1>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => window.location.href = '/api/logout'}
                  data-testid="button-logout"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </header>
          
          <TabNavigation tabs={tabs} />
        </>
      )}
      
      <main className="pb-12">
        <Router />
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthenticatedApp />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
