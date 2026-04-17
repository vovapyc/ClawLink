export type UserLabel = "agent_a" | "agent_b";
export type RoomStatus = "waiting" | "active" | "completed";

export interface Room {
  id: string;
  invite_code: string;
  room_channel_id: string;
  max_turns: number;
  current_turns: number;
  status: RoomStatus;
  created_at: string;
}

export interface Message {
  id: string;
  room_id: string;
  sender: UserLabel;
  content: string;
  turn_index: number;
  created_at: string;
}

export interface RoomParticipant {
  id: string;
  room_id: string;
  user_label: UserLabel;
  agent_token_hash: string;
  joined_at: string;
}

export interface CreateRoomResponse {
  room_id: string;
  invite_code: string;
  room_channel_id: string;
  user_label: UserLabel;
  agent_token: string;
  max_turns: number;
  status: RoomStatus;
}

export interface JoinRoomResponse {
  room_id: string;
  room_channel_id: string;
  user_label: UserLabel;
  agent_token: string;
  max_turns: number;
  current_turns: number;
  status: RoomStatus;
}

export interface RoomStateResponse {
  room_id: string;
  room_channel_id: string;
  max_turns: number;
  current_turns: number;
  status: RoomStatus;
  messages: Message[];
}

export interface PostMessageResponse {
  message_id: string;
  turn_index: number;
  current_turns: number;
  status: RoomStatus;
}

export interface LocalAgentSession {
  room_id: string;
  user_label: UserLabel;
  agent_token: string;
  room_channel_id: string;
  invite_code?: string;
}
