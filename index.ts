import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set");
}

// Function that prints chat messages
const printMessage = (message: OpenAIChatMessage) => {
  const roleColours = {};
};

type OpenAIChatMessage = OpenAI.ChatCompletionMessage | OpenAI.ChatCompletionUserMessageParam | OpenAI.ChatCompletionToolMessageParam | OpenAI.ChatCompletionSystemMessageParam;

class MCPClient {
  private mcpClient: Client;
  private openAI: OpenAI;
  private transport: StdioClientTransport | null = null;
  private messages: OpenAIChatMessage[];
  private openAITools: OpenAI.ChatCompletionTool[] = [];

  constructor(systemPrompt: string, private onNewMessage?: (message: OpenAIChatMessage) => void) {
    this.openAI = new OpenAI({
      apiKey: GEMINI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
    });
    this.mcpClient = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    this.messages = [{role: "system", content: systemPrompt}];
  }

  async connectToServer(serverScriptPath: string) {
    try {
      const isJs = serverScriptPath.endsWith(".js");
      const isPy = serverScriptPath.endsWith(".py");
      if (!isJs && !isPy) {
        throw new Error("Server script must be a .js or .py file!");
      }
      const command = isJs ? process.execPath : (process.platform === "win32" ? "python" : "python3");

      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath]
      });
      await this.mcpClient.connect(this.transport);

      const mcpTools = await this.mcpClient.listTools();
      this.openAITools = mcpTools.tools.map(tool => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: tool.inputSchema.type,
            properties: tool.inputSchema.properties
          }
        }
      }));

      console.log(
        "Connected to MCP server with tools:",
        this.openAITools.map(tool => tool.function.name)
      );
    } catch (err) {
      console.log("Failed to connect to MCP server: ", err);
      throw err;
    }
  }

  async processQuery(query: string) {
    this.addMessage({
      role: "user",
      content: query
    });

    const initialResponse = await this.openAI.chat.completions.create({
      model: "gemini-2.5-flash",
      reasoning_effort: "low",
      messages: this.messages,
      tools: this.openAITools
    })

    const assistantMessage = initialResponse.choices[0].message;
    this.addMessage(assistantMessage);

    let toolCalls = assistantMessage.tool_calls;
    if (!toolCalls || toolCalls.length === 0) return; // finished here if no tools needed

    while (toolCalls && toolCalls.length > 0) {
      // Call all the needed tools and add the tools' responses to the chat history
      for (const toolCall of toolCalls) {
        const toolCallResult = await this.mcpClient.callTool({
          name: toolCall.function.name,
          arguments: JSON.parse(toolCall.function.arguments)
        });

        const toolMessage = {
          role: "tool" as const,
          content: JSON.stringify(toolCallResult.content),
          tool_call_id: toolCall.id
        };

        this.addMessage(toolMessage);
      }

      // Provide the LLM the updated chat history containing the tool call results and get its response
      const toolCallFollowUpResponse = await this.openAI.chat.completions.create({
        model: "gemini-2.5-flash",
        reasoning_effort: "low",
        messages: this.messages,
        tools: this.openAITools
      });
      const toolCallFollowUpMessage = toolCallFollowUpResponse.choices[0].message;
      this.addMessage(toolCallFollowUpMessage);

      toolCalls = toolCallFollowUpMessage.tool_calls; // new set of tool calls if needed
    }
  }
  
  private addMessage(message: OpenAIChatMessage) {
    this.messages.push(message);
    this.onNewMessage?.(message);
  }

  private async chatLoop() {
    // Create readline interface for user input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    

    try {
      console.log("\nMCP Client started!");
      console.log("Type your queries or 'quit' to exit.");
    } finally {
      rl.close();
    }
  }
}

async function main() {
  const myMCPClient = new MCPClient("You are an assistant who supports your user. You will have access to a list of tools and resources that you may need to respond to the user's messages properly.");

  console.log("MCP Client started.");
  console.log("You may now chat with the assistant.");
  console.log("To end the conversation, please type 'exit' or 'quit'.");
}