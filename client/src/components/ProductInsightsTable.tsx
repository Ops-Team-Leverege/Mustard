import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

export interface ProductInsight {
  id: string;
  feature: string;
  context: string;
  quote: string;
  company: string;
  category: string;
}

interface ProductInsightsTableProps {
  insights: ProductInsight[];
  categories?: string[];
}

export default function ProductInsightsTable({ insights, categories = [] }: ProductInsightsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const filteredInsights = insights.filter(insight => {
    const matchesSearch = 
      insight.feature.toLowerCase().includes(searchQuery.toLowerCase()) ||
      insight.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      insight.context.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = categoryFilter === 'all' || insight.category === categoryFilter;
    
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search features or companies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-insights"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[200px]" data-testid="select-category-filter">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
            <SelectItem value="NEW">NEW</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Feature</TableHead>
              <TableHead className="w-[200px]">Context</TableHead>
              <TableHead>Customer Quote</TableHead>
              <TableHead className="w-[150px]">Company</TableHead>
              <TableHead className="w-[120px]">Category</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInsights.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No insights found
                </TableCell>
              </TableRow>
            ) : (
              filteredInsights.map((insight) => (
                <TableRow key={insight.id} data-testid={`row-insight-${insight.id}`}>
                  <TableCell className="font-medium" data-testid={`text-feature-${insight.id}`}>
                    {insight.feature}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {insight.context}
                  </TableCell>
                  <TableCell>
                    <div className="border-l-2 border-chart-3 bg-chart-3/10 pl-3 py-2 italic text-sm">
                      "{insight.quote}"
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal" data-testid={`badge-company-${insight.id}`}>
                      {insight.company}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={insight.category === 'NEW' ? 'default' : 'outline'}
                      className={insight.category === 'NEW' ? 'bg-chart-4 hover:bg-chart-4' : ''}
                      data-testid={`badge-category-${insight.id}`}
                    >
                      {insight.category}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
