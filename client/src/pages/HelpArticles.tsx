import { useEffect } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'gen-search-widget': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        configId?: string;
        location?: string;
        triggerId?: string;
      };
    }
  }
}

export default function HelpArticles() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cloud.google.com/ai/gen-app-builder/client?hl=en_US';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Help Articles</h1>
      
      <gen-search-widget
        configId="1b2b5acc-a788-475d-bd04-dcb4620c9054"
        location="us"
        triggerId="searchWidgetTrigger"
      />

      <input 
        placeholder="Search here" 
        id="searchWidgetTrigger"
        className="w-full max-w-md px-4 py-2 border rounded-md bg-background text-foreground"
        data-testid="input-help-search"
      />
    </div>
  );
}
