// From Replit Auth integration (blueprint:javascript_log_in_with_replit)
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, MessageSquare, Tags, Building2 } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto space-y-12">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold tracking-tight" data-testid="heading-title">
              BD Transcript Analyzer
            </h1>
            <p className="text-xl text-muted-foreground" data-testid="text-subtitle">
              Transform business development call transcripts into actionable product insights
            </p>
            <div className="pt-4">
              <Button 
                size="lg" 
                onClick={() => window.location.href = '/api/login'}
                data-testid="button-login"
              >
                Log In to Get Started
              </Button>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card data-testid="card-feature-insights">
              <CardHeader className="space-y-1">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  <CardTitle>Product Insights</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Extract and organize feature requests from customer conversations with AI-powered analysis
                </CardDescription>
              </CardContent>
            </Card>

            <Card data-testid="card-feature-qa">
              <CardHeader className="space-y-1">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  <CardTitle>Q&A Tracking</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Capture important questions and answers from BD calls, linked to specific contacts
                </CardDescription>
              </CardContent>
            </Card>

            <Card data-testid="card-feature-categories">
              <CardHeader className="space-y-1">
                <div className="flex items-center gap-2">
                  <Tags className="h-5 w-5 text-primary" />
                  <CardTitle>Smart Categorization</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Automatically categorize insights and Q&A pairs for easy filtering and reporting
                </CardDescription>
              </CardContent>
            </Card>

            <Card data-testid="card-feature-companies">
              <CardHeader className="space-y-1">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <CardTitle>Company Management</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Track customer companies, contacts, and conversation history in one place
                </CardDescription>
              </CardContent>
            </Card>
          </div>

          <div className="text-center space-y-4 pt-8">
            <h2 className="text-2xl font-semibold" data-testid="heading-cta">
              Ready to streamline your BD insights?
            </h2>
            <Button 
              size="lg" 
              onClick={() => window.location.href = '/api/login'}
              data-testid="button-login-bottom"
            >
              Log In Now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
