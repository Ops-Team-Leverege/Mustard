/* This file takes retrieved chunks

builds the prompt
enforces grounding & citations
returns { answer, citations }
This is where you encode rules like:
“If evidence is missing, say so”
“Every claim must cite a chunk”
This keeps correctness centralized. */


