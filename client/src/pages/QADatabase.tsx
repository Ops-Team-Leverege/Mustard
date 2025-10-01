import QATable from "@/components/QATable";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";

export default function QADatabase() {
  const [, setLocation] = useLocation();

  // Mock data - will be replaced with real data
  const qaPairs = [
    {
      id: '1',
      question: 'Does your platform support integration with SAP?',
      answer: 'Yes, we have a native SAP connector that syncs data bi-directionally in real-time using their REST API.',
      asker: 'Mike Chen',
      company: 'LogiTech Solutions'
    },
    {
      id: '2',
      question: 'What is the typical implementation timeline?',
      answer: 'For a standard deployment with 100-500 devices, we typically complete implementation in 4-6 weeks including training.',
      asker: 'Sarah Parker',
      company: 'TransGlobal'
    },
    {
      id: '3',
      question: 'Can we customize the reporting dashboards?',
      answer: 'Absolutely, our platform includes a drag-and-drop dashboard builder that lets you create custom views without coding.',
      asker: 'David Lee',
      company: 'FreshFoods Inc'
    },
    {
      id: '4',
      question: 'What kind of API access do you provide?',
      answer: 'We offer a comprehensive REST API with full CRUD operations, webhooks for real-time events, and GraphQL for complex queries.',
      asker: 'Jennifer Wang',
      company: 'LogiTech Solutions'
    },
  ];

  return (
    <div className="container mx-auto py-8 px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Customer Q&A Database</h1>
          <p className="text-muted-foreground mt-1">
            Product-specific questions and BD answers
          </p>
        </div>
        <Button onClick={() => setLocation('/')} data-testid="button-add-transcript">
          <Plus className="w-4 h-4 mr-2" />
          Add Transcript
        </Button>
      </div>

      <QATable qaPairs={qaPairs} />
    </div>
  );
}
