import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import TabNavigation from "@/components/TabNavigation";
import ThemeToggle from "@/components/ThemeToggle";
import TranscriptInput from "@/pages/TranscriptInput";
import Transcripts from "@/pages/Transcripts";
import Latest from "@/pages/Latest";
import ProductInsights from "@/pages/ProductInsights";
import QADatabase from "@/pages/QADatabase";
import Categories from "@/pages/Categories";
import Features from "@/pages/Features";
import FeatureDetail from "@/pages/FeatureDetail";
import Companies from "@/pages/Companies";
import CompanyPage from "@/pages/CompanyPage";
import CategoryPage from "@/pages/CategoryPage";
import TranscriptDetailPage from "@/pages/TranscriptDetailPage";
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
  { 
    id: 'databases', 
    label: 'Databases', 
    items: [
      { id: 'insights', label: 'Product Insights', path: '/insights' },
      { id: 'qa', label: 'Q&A Database', path: '/qa' },
      { id: 'transcripts', label: 'Transcripts', path: '/transcripts' },
    ]
  },
  { id: 'latest', label: 'Latest', path: '/latest' },
  { id: 'companies', label: 'Companies', path: '/companies' },
  { id: 'categories', label: 'Categories', path: '/categories' },
  { id: 'features', label: 'Features', path: '/features' },
];

function ProtectedRoute({ 
  component: Component, 
  isAuthenticated, 
  isLoading, 
  isDomainRestricted 
}: { 
  component: any; 
  isAuthenticated: boolean | null; 
  isLoading: boolean; 
  isDomainRestricted: boolean; 
}) {
  if (isLoading || !isAuthenticated || isDomainRestricted) {
    return <Landing />;
  }

  return <Component />;
}

function Router() {
  const { isAuthenticated, isLoading, error } = useAuth();
  
  const isDomainRestricted = Boolean(error && 
    (String(error).includes('403') || String(error).includes('DOMAIN_RESTRICTED')));

  return (
    <Switch>
      <Route path="/">
        <ProtectedRoute 
          component={TranscriptInput} 
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          isDomainRestricted={isDomainRestricted}
        />
      </Route>
      <Route path="/transcripts">
        <ProtectedRoute 
          component={Transcripts} 
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          isDomainRestricted={isDomainRestricted}
        />
      </Route>
      <Route path="/latest">
        <ProtectedRoute 
          component={Latest} 
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          isDomainRestricted={isDomainRestricted}
        />
      </Route>
      <Route path="/insights">
        <ProtectedRoute 
          component={ProductInsights} 
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          isDomainRestricted={isDomainRestricted}
        />
      </Route>
      <Route path="/qa">
        <ProtectedRoute 
          component={QADatabase} 
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          isDomainRestricted={isDomainRestricted}
        />
      </Route>
      <Route path="/companies">
        <ProtectedRoute 
          component={Companies} 
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          isDomainRestricted={isDomainRestricted}
        />
      </Route>
      <Route path="/companies/:slug">
        <ProtectedRoute 
          component={CompanyPage} 
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          isDomainRestricted={isDomainRestricted}
        />
      </Route>
      <Route path="/categories">
        <ProtectedRoute 
          component={Categories} 
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          isDomainRestricted={isDomainRestricted}
        />
      </Route>
      <Route path="/categories/:id">
        <ProtectedRoute 
          component={CategoryPage} 
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          isDomainRestricted={isDomainRestricted}
        />
      </Route>
      <Route path="/features">
        <ProtectedRoute 
          component={Features} 
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          isDomainRestricted={isDomainRestricted}
        />
      </Route>
      <Route path="/features/:id">
        <ProtectedRoute 
          component={FeatureDetail} 
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          isDomainRestricted={isDomainRestricted}
        />
      </Route>
      <Route path="/transcripts/:id">
        <ProtectedRoute 
          component={TranscriptDetailPage} 
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          isDomainRestricted={isDomainRestricted}
        />
      </Route>
      <Route>
        <Landing />
      </Route>
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
                  <h1 className="font-semibold text-lg">Mustard for PitCrew</h1>
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
