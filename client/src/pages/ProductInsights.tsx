import ProductInsightsTable from "@/components/ProductInsightsTable";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";

export default function ProductInsights() {
  const [, setLocation] = useLocation();

  // Mock data - will be replaced with real data
  const insights = [
    {
      id: '1',
      feature: 'Real-time Analytics Dashboard',
      context: 'Need to monitor fleet performance in real-time for operational efficiency',
      quote: 'We absolutely need to see our vehicles in real-time, not 5 minutes delayed. Every second counts in our logistics.',
      company: 'LogiTech Solutions',
      category: 'Analytics'
    },
    {
      id: '2',
      feature: 'Mobile App Offline Mode',
      context: 'Drivers work in areas with poor connectivity and need offline functionality',
      quote: 'Our drivers are often in remote areas with no signal. They need to be able to log deliveries offline.',
      company: 'TransGlobal',
      category: 'Mobile'
    },
    {
      id: '3',
      feature: 'Custom Alert Rules',
      context: 'Want to define custom thresholds for temperature monitoring per product line',
      quote: 'Each product line has different temperature requirements. We need customizable alerts for each SKU.',
      company: 'FreshFoods Inc',
      category: 'NEW'
    },
  ];

  const categories = ['Analytics', 'Mobile', 'Integration', 'Security'];

  return (
    <div className="container mx-auto py-8 px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Product Insights & Feature Demand</h1>
          <p className="text-muted-foreground mt-1">
            Feature requests and context from BD calls
          </p>
        </div>
        <Button onClick={() => setLocation('/')} data-testid="button-add-transcript">
          <Plus className="w-4 h-4 mr-2" />
          Add Transcript
        </Button>
      </div>

      <ProductInsightsTable insights={insights} categories={categories} />
    </div>
  );
}
