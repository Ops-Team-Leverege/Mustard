import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Settings, Loader2, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: {
      name: string;
      statusCategory: {
        name: string;
      };
    };
    issuetype: {
      name: string;
      iconUrl: string;
    };
    priority?: {
      name: string;
      iconUrl: string;
    };
    assignee?: {
      displayName: string;
      avatarUrls: {
        '48x48': string;
      };
    };
    created: string;
    updated: string;
    duedate?: string;
    description?: any;
    project: {
      key: string;
      name: string;
    };
  };
}

export default function Roadmap() {
  const { toast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectInput, setProjectInput] = useState("");

  const { data: projectConfig, isLoading: configLoading } = useQuery<{ projectKeys: string[] }>({
    queryKey: ["/api/roadmap/jira-projects"],
  });

  const { data: issues = [], isLoading: issuesLoading } = useQuery<JiraIssue[]>({
    queryKey: ["/api/roadmap/issues"],
    enabled: (projectConfig?.projectKeys || []).length > 0,
  });

  const updateProjectsMutation = useMutation({
    mutationFn: async (projectKeys: string[]) => {
      const res = await apiRequest("PUT", "/api/roadmap/jira-projects", { projectKeys });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roadmap/jira-projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/roadmap/issues"] });
      toast({
        title: "Projects updated",
        description: "Your Jira project configuration has been saved.",
      });
      setSettingsOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update projects",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const projectKeys = projectConfig?.projectKeys || [];

  const handleAddProject = () => {
    const trimmed = projectInput.trim().toUpperCase();
    if (!trimmed) return;
    
    if (projectKeys.includes(trimmed)) {
      toast({
        title: "Project already added",
        description: `${trimmed} is already in your project list.`,
        variant: "destructive",
      });
      return;
    }

    updateProjectsMutation.mutate([...projectKeys, trimmed]);
    setProjectInput("");
  };

  const handleRemoveProject = (key: string) => {
    updateProjectsMutation.mutate(projectKeys.filter(k => k !== key));
  };

  const getStatusColor = (categoryName: string) => {
    switch (categoryName.toLowerCase()) {
      case 'done':
        return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20';
      case 'in progress':
        return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20';
      default:
        return 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20';
    }
  };

  const groupedIssues = issues.reduce((acc, issue) => {
    const projectKey = issue.fields.project.key;
    if (!acc[projectKey]) {
      acc[projectKey] = {
        name: issue.fields.project.name,
        issues: []
      };
    }
    acc[projectKey].issues.push(issue);
    return acc;
  }, {} as Record<string, { name: string; issues: JiraIssue[] }>);

  if (configLoading) {
    return (
      <div className="h-full overflow-auto">
        <div className="container mx-auto p-6 max-w-7xl">
          <Skeleton className="h-10 w-64 mb-2" />
          <Skeleton className="h-6 w-96 mb-8" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2" data-testid="text-page-title">Product Roadmap</h1>
            <p className="text-muted-foreground" data-testid="text-page-description">
              View and track Jira issues from your configured projects
            </p>
          </div>
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="default" data-testid="button-settings">
                <Settings className="h-4 w-4 mr-2" />
                Configure Projects
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Configure Jira Projects</DialogTitle>
                <DialogDescription>
                  Add the Jira project keys you want to track on your roadmap.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Project key (e.g., PROJ)"
                    value={projectInput}
                    onChange={(e) => setProjectInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddProject();
                      }
                    }}
                    data-testid="input-project-key"
                  />
                  <Button
                    onClick={handleAddProject}
                    disabled={updateProjectsMutation.isPending}
                    data-testid="button-add-project"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2">
                  {projectKeys.map((key) => (
                    <div
                      key={key}
                      className="flex items-center justify-between p-2 rounded-md border"
                      data-testid={`project-item-${key}`}
                    >
                      <span className="font-medium">{key}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveProject(key)}
                        disabled={updateProjectsMutation.isPending}
                        data-testid={`button-remove-${key}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {projectKeys.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No projects configured yet. Add your first project above.
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSettingsOpen(false)}>
                  Done
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {projectKeys.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Settings className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No projects configured</h3>
              <p className="text-muted-foreground text-center mb-4">
                Get started by adding your Jira project keys to track issues on your roadmap.
              </p>
              <Button onClick={() => setSettingsOpen(true)} data-testid="button-configure">
                Configure Projects
              </Button>
            </CardContent>
          </Card>
        ) : issuesLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-48" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : issues.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground text-center">
                No issues found in the configured projects.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedIssues).map(([projectKey, { name, issues: projectIssues }]) => (
              <Card key={projectKey}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span>{name}</span>
                    <Badge variant="secondary">{projectKey}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {projectIssues.length} {projectIssues.length === 1 ? 'issue' : 'issues'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {projectIssues.map((issue) => (
                      <div
                        key={issue.id}
                        className="flex items-start gap-4 p-4 rounded-lg border hover-elevate"
                        data-testid={`issue-${issue.key}`}
                      >
                        <img
                          src={issue.fields.issuetype.iconUrl}
                          alt={issue.fields.issuetype.name}
                          className="w-5 h-5 mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <a
                              href={`https://${issue.key.split('-')[0].toLowerCase()}.atlassian.net/browse/${issue.key}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-sm hover:underline flex items-center gap-1"
                              data-testid={`link-${issue.key}`}
                            >
                              {issue.key}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <Badge className={getStatusColor(issue.fields.status.statusCategory.name)}>
                              {issue.fields.status.name}
                            </Badge>
                          </div>
                          <p className="text-sm mb-2">{issue.fields.summary}</p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>{issue.fields.issuetype.name}</span>
                            {issue.fields.assignee && (
                              <div className="flex items-center gap-1">
                                <img
                                  src={issue.fields.assignee.avatarUrls['48x48']}
                                  alt={issue.fields.assignee.displayName}
                                  className="w-4 h-4 rounded-full"
                                />
                                <span>{issue.fields.assignee.displayName}</span>
                              </div>
                            )}
                            {issue.fields.priority && (
                              <div className="flex items-center gap-1">
                                <img
                                  src={issue.fields.priority.iconUrl}
                                  alt={issue.fields.priority.name}
                                  className="w-4 h-4"
                                />
                                <span>{issue.fields.priority.name}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
