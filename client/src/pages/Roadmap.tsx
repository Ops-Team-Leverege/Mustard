import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Settings, Calendar, User, Flag, Tag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { RoadmapConfig, RoadmapTicket } from "@shared/schema";

export default function Roadmap() {
  const { toast } = useToast();
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [projectKey1, setProjectKey1] = useState("");
  const [projectKey2, setProjectKey2] = useState("");

  const { data: config } = useQuery<RoadmapConfig | null>({
    queryKey: ["/api/roadmap/config"],
  });

  const { data: tickets = [], isLoading: isLoadingTickets } = useQuery<RoadmapTicket[]>({
    queryKey: ["/api/roadmap/tickets"],
  });

  const configMutation = useMutation({
    mutationFn: async (data: { projectKey1: string; projectKey2: string }) =>
      apiRequest("/api/roadmap/config", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roadmap/config"] });
      setIsConfigOpen(false);
      toast({
        title: "Configuration saved",
        description: "Roadmap projects have been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () =>
      apiRequest("/api/roadmap/sync", {
        method: "POST",
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/roadmap/tickets"] });
      toast({
        title: "Sync complete",
        description: `Successfully synced ${data.ticketCount} tickets from Jira.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleConfigSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectKey1 || !projectKey2) {
      toast({
        title: "Missing project keys",
        description: "Please enter both project keys.",
        variant: "destructive",
      });
      return;
    }
    configMutation.mutate({ projectKey1, projectKey2 });
  };

  const handleOpenConfig = () => {
    if (config) {
      setProjectKey1(config.projectKey1);
      setProjectKey2(config.projectKey2);
    }
    setIsConfigOpen(true);
  };

  const project1Tickets = tickets.filter(t => t.projectKey === config?.projectKey1);
  const project2Tickets = tickets.filter(t => t.projectKey === config?.projectKey2);

  const getPriorityColor = (priority: string | null) => {
    if (!priority) return "bg-gray-500";
    const lower = priority.toLowerCase();
    if (lower.includes("high") || lower.includes("critical")) return "bg-red-500";
    if (lower.includes("medium")) return "bg-orange-500";
    return "bg-blue-500";
  };

  const getStatusColor = (status: string) => {
    const lower = status.toLowerCase();
    if (lower.includes("done") || lower.includes("closed")) return "bg-green-600";
    if (lower.includes("progress") || lower.includes("development")) return "bg-blue-600";
    if (lower.includes("review")) return "bg-purple-600";
    return "bg-gray-600";
  };

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Roadmap</h1>
          <p className="text-muted-foreground mt-1">
            Track and manage Jira tickets from your projects
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isConfigOpen} onOpenChange={setIsConfigOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                onClick={handleOpenConfig}
                data-testid="button-configure-roadmap"
              >
                <Settings className="h-4 w-4 mr-2" />
                Configure Projects
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Configure Jira Projects</DialogTitle>
                <DialogDescription>
                  Enter the project keys for the two Jira projects you want to track in your roadmap.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleConfigSubmit} className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="project1">Project 1 Key</Label>
                  <Input
                    id="project1"
                    value={projectKey1}
                    onChange={(e) => setProjectKey1(e.target.value)}
                    placeholder="e.g., PROJ1"
                    data-testid="input-project-key-1"
                  />
                </div>
                <div>
                  <Label htmlFor="project2">Project 2 Key</Label>
                  <Input
                    id="project2"
                    value={projectKey2}
                    onChange={(e) => setProjectKey2(e.target.value)}
                    placeholder="e.g., PROJ2"
                    data-testid="input-project-key-2"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsConfigOpen(false)}
                    data-testid="button-cancel-config"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={configMutation.isPending}
                    data-testid="button-save-config"
                  >
                    {configMutation.isPending && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Save Configuration
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Button
            onClick={() => syncMutation.mutate()}
            disabled={!config || syncMutation.isPending}
            data-testid="button-sync-roadmap"
          >
            {syncMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Sync from Jira
              </>
            )}
          </Button>
        </div>
      </div>

      {!config && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              No projects configured. Click "Configure Projects" to get started.
            </p>
          </CardContent>
        </Card>
      )}

      {config && (
        <div className="space-y-8">
          <div>
            <h2 className="text-2xl font-semibold mb-4">{config.projectKey1}</h2>
            {isLoadingTickets ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : project1Tickets.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-center text-muted-foreground">
                    No tickets found. Click "Sync from Jira" to fetch tickets.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {project1Tickets.map((ticket) => (
                  <Card key={ticket.id} className="hover-elevate" data-testid={`ticket-${ticket.jiraKey}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg flex items-center gap-2">
                            <span className="text-muted-foreground text-sm font-mono">
                              {ticket.jiraKey}
                            </span>
                            {ticket.summary}
                          </CardTitle>
                          <CardDescription className="mt-2">
                            {ticket.description}
                          </CardDescription>
                        </div>
                        <Badge className={getStatusColor(ticket.status)}>
                          {ticket.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Tag className="h-4 w-4" />
                          <span>{ticket.issueType}</span>
                        </div>
                        {ticket.priority && (
                          <div className="flex items-center gap-1">
                            <Flag className={`h-4 w-4 ${getPriorityColor(ticket.priority)}`} />
                            <span>{ticket.priority}</span>
                          </div>
                        )}
                        {ticket.assignee && (
                          <div className="flex items-center gap-1">
                            <User className="h-4 w-4" />
                            <span>{ticket.assignee}</span>
                          </div>
                        )}
                        {ticket.dueDate && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>{new Date(ticket.dueDate).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                      {ticket.labels && ticket.labels.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {ticket.labels.map((label) => (
                            <Badge key={label} variant="outline">
                              {label}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-2xl font-semibold mb-4">{config.projectKey2}</h2>
            {isLoadingTickets ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : project2Tickets.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-center text-muted-foreground">
                    No tickets found. Click "Sync from Jira" to fetch tickets.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {project2Tickets.map((ticket) => (
                  <Card key={ticket.id} className="hover-elevate" data-testid={`ticket-${ticket.jiraKey}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg flex items-center gap-2">
                            <span className="text-muted-foreground text-sm font-mono">
                              {ticket.jiraKey}
                            </span>
                            {ticket.summary}
                          </CardTitle>
                          <CardDescription className="mt-2">
                            {ticket.description}
                          </CardDescription>
                        </div>
                        <Badge className={getStatusColor(ticket.status)}>
                          {ticket.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Tag className="h-4 w-4" />
                          <span>{ticket.issueType}</span>
                        </div>
                        {ticket.priority && (
                          <div className="flex items-center gap-1">
                            <Flag className={`h-4 w-4 ${getPriorityColor(ticket.priority)}`} />
                            <span>{ticket.priority}</span>
                          </div>
                        )}
                        {ticket.assignee && (
                          <div className="flex items-center gap-1">
                            <User className="h-4 w-4" />
                            <span>{ticket.assignee}</span>
                          </div>
                        )}
                        {ticket.dueDate && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>{new Date(ticket.dueDate).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                      {ticket.labels && ticket.labels.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {ticket.labels.map((label) => (
                            <Badge key={label} variant="outline">
                              {label}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
