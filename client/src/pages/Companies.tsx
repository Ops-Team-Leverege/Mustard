import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Building2 } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";

interface Company {
  id: string;
  name: string;
  slug: string;
  notes?: string | null;
  stage?: string | null;
  createdAt: Date;
}

function getStageStyles(stage: string) {
  switch (stage) {
    case 'Prospect':
      return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800';
    case 'Pilot':
      return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900';
    case 'Rollout':
      return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900';
    case 'Scale':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800';
  }
}

export default function Companies() {
  const [searchQuery, setSearchQuery] = useState('');

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });

  const filteredCompanies = companies.filter(company =>
    company.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">
        <div className="text-center py-12 text-muted-foreground">Loading companies...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold">Companies</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Browse all companies with BD call transcripts
            </p>
          </div>
          <Badge variant="secondary" className="font-normal">
            {companies.length} {companies.length === 1 ? 'company' : 'companies'}
          </Badge>
        </div>
        
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search companies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-companies"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredCompanies.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-12 text-center">
              <Building2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                {searchQuery ? 'No companies match your search' : 'No companies yet'}
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredCompanies.map((company) => (
            <Link key={company.id} href={`/companies/${company.slug}`}>
              <Card className="hover-elevate cursor-pointer h-full" data-testid={`card-company-${company.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <CardTitle className="text-base truncate">{company.name}</CardTitle>
                    </div>
                    {company.stage && (
                      <Badge 
                        variant="outline" 
                        className={`text-xs flex-shrink-0 ${getStageStyles(company.stage)}`}
                        data-testid={`badge-stage-${company.id}`}
                      >
                        {company.stage}
                      </Badge>
                    )}
                  </div>
                  {company.notes && (
                    <CardDescription className="text-xs mt-2 line-clamp-2">
                      {company.notes}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>View insights & Q&A →</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
