import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Keyword {
  text: string;
  count: number;
}

export default function KeywordBubble() {
  const { data: keywords = [], isLoading } = useQuery<Keyword[]>({
    queryKey: ['/api/insights/keywords'],
  });

  if (isLoading) {
    return (
      <Card data-testid="card-keyword-bubble">
        <CardHeader>
          <CardTitle>Feature Keywords</CardTitle>
          <CardDescription>Most frequently mentioned features</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (keywords.length === 0) {
    return (
      <Card data-testid="card-keyword-bubble">
        <CardHeader>
          <CardTitle>Feature Keywords</CardTitle>
          <CardDescription>Most frequently mentioned features</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-12" data-testid="text-no-keywords">
            No keywords available yet. Add insights to see the keyword cloud.
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxCount = Math.max(...keywords.map(k => k.count));
  const minCount = Math.min(...keywords.map(k => k.count));
  
  const getFontSize = (count: number) => {
    if (maxCount === minCount) return 1.25;
    const normalized = (count - minCount) / (maxCount - minCount);
    return 0.875 + normalized * 1.625;
  };

  const getOpacity = (count: number) => {
    if (maxCount === minCount) return 0.9;
    const normalized = (count - minCount) / (maxCount - minCount);
    return 0.5 + normalized * 0.5;
  };

  const topKeywords = keywords.slice(0, 30);

  return (
    <Card data-testid="card-keyword-bubble">
      <CardHeader>
        <CardTitle>Feature Keywords</CardTitle>
        <CardDescription>
          Most frequently mentioned features ({topKeywords.length} shown)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div 
          className="flex flex-wrap gap-3 items-center justify-center py-4 min-h-[200px]"
          data-testid="container-keywords"
        >
          {topKeywords.map((keyword, index) => (
            <div
              key={index}
              className="transition-all hover-elevate px-3 py-1.5 rounded-md bg-primary/5 border border-primary/10"
              style={{
                fontSize: `${getFontSize(keyword.count)}rem`,
                opacity: getOpacity(keyword.count),
              }}
              data-testid={`keyword-${index}`}
            >
              <span className="font-medium text-foreground">
                {keyword.text}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {keyword.count}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
