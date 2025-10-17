import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Building2, FileText, Calendar } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { format } from "date-fns";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

type Product = "PitCrew" | "AutoTrace" | "WorkWatch";

interface User {
  id: string;
  email: string | null;
  currentProduct: Product;
}

interface Company {
  id: string;
  name: string;
  slug: string;
  notes?: string | null;
  stage?: string | null;
  serviceTags?: string[] | null;
  createdAt: Date;
}

interface RecentTranscript {
  id: string;
  name: string | null;
  companyName: string;
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

const STAGE_COLORS: Record<string, string> = {
  'Prospect': '#64748b',
  'Pilot': '#3b82f6',
  'Rollout': '#f97316',
  'Scale': '#10b981',
  'Unknown': '#6b7280',
};

export default function Companies() {
  const [searchQuery, setSearchQuery] = useState('');

  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/user"],
  });

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });

  const { data: recentTranscripts = [] } = useQuery<RecentTranscript[]>({
    queryKey: ['/api/dashboard/recent-transcripts'],
  });

  const { data: dashboardStats } = useQuery<{ stageStats: Record<string, number> }>({
    queryKey: ['/api/dashboard/stats'],
  });

  const filteredCompanies = companies.filter(company =>
    company.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pieData = dashboardStats?.stageStats ? Object.entries(dashboardStats.stageStats).map(([name, value]) => ({
    name,
    value,
  })) : [];

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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Recent Meetings (Last 7 Days)
              </CardTitle>
              <CardDescription>Latest meeting transcripts</CardDescription>
            </CardHeader>
            <CardContent>
              {recentTranscripts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No meetings in the last 7 days
                </p>
              ) : (
                <div className="space-y-3">
                  {recentTranscripts.map((transcript) => (
                    <Link key={transcript.id} href={`/transcripts/${transcript.id}`}>
                      <div className="flex items-start justify-between gap-3 p-3 rounded-md hover-elevate cursor-pointer border" data-testid={`recent-transcript-${transcript.id}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {transcript.name || 'Untitled Meeting'}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {transcript.companyName}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                          <Calendar className="h-3 w-3" />
                          {(() => {
                            const dateStr = typeof transcript.createdAt === 'string' ? transcript.createdAt : transcript.createdAt.toISOString();
                            const datePart = dateStr.split('T')[0];
                            return format(new Date(datePart + 'T12:00:00'), 'MMM d');
                          })()}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Companies by Stage
              </CardTitle>
              <CardDescription>Distribution across sales stages</CardDescription>
            </CardHeader>
            <CardContent>
              {pieData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No stage data available
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={70}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={STAGE_COLORS[entry.name] || STAGE_COLORS['Unknown']} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
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
                  {user?.currentProduct === "PitCrew" && company.serviceTags && company.serviceTags.length > 0 ? (
                    <div className="flex gap-2 flex-wrap">
                      {company.serviceTags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs" data-testid={`badge-service-tag-${company.id}-${tag}`}>
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground/50">
                      No service tags
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
