import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../config/axios.config.js';

// Async thunk for fetching tasks
export const fetchTasks = createAsyncThunk(
  'tasks/fetchTasks',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get('/api/pagewise/tasks', {
        withCredentials: true
      });
      
      if (response.status === 200 && response.data?.data) {
        const { tasks = [], taskRenewalDate = null } = response.data.data;
        return { tasks, taskRenewalDate };
      } else {
        return rejectWithValue('Failed to fetch tasks data');
      }
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch tasks');
    }
  }
);

// Async thunk for updating task status
export const updateTaskStatus = createAsyncThunk(
  'tasks/updateTaskStatus',
  async ({ taskId, status }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put(
        '/api/pagewise/tasks/status',
        { taskId, status },
        { withCredentials: true }
      );
      
      if (response.status === 200) {
        return { taskId, status };
      } else {
        return rejectWithValue('Failed to update task status');
      }
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update task status');
    }
  }
);

const initialState = {
  tasks: [],
  taskRenewalDate: null,
  loading: false,
  error: null,
  lastFetched: null,
  completedTasks: [] // Track completed task IDs as array (Sets aren't serializable)
};

const TasksSlice = createSlice({
  name: 'tasks',
  initialState,
  reducers: {
    setCompletedTasks: (state, action) => {
      state.completedTasks = Array.isArray(action.payload) ? action.payload : [...action.payload];
    },
    
    toggleTaskStatusLocal: (state, action) => {
      const { taskId } = action.payload;
      const index = state.completedTasks.indexOf(taskId);
      
      if (index > -1) {
        state.completedTasks.splice(index, 1);
      } else {
        state.completedTasks.push(taskId);
      }
    },
    
    clearTasks: (state) => {
      state.tasks = [];
      state.completedTasks = [];
      state.error = null;
      state.lastFetched = null;
    }
  },
  extraReducers: (builder) => {
    // Fetch tasks
    builder
      .addCase(fetchTasks.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTasks.fulfilled, (state, action) => {
        state.loading = false;
        const { tasks = [], taskRenewalDate = null } = action.payload;
        state.tasks = tasks;
        state.taskRenewalDate = taskRenewalDate;
        state.lastFetched = Date.now();
        state.error = null;
        
        // Initialize completedTasks based on task status
        const completedTaskIds = [];
        tasks.forEach(task => {
          if (task.status === 'completed') {
            completedTaskIds.push(task.taskId);
          }
        });
        state.completedTasks = completedTaskIds;
      })
      .addCase(fetchTasks.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
    
    // Update task status
    builder
      .addCase(updateTaskStatus.pending, (state) => {
        // Optimistic update - no loading state needed
      })
      .addCase(updateTaskStatus.fulfilled, (state, action) => {
        const { taskId, status } = action.payload;
        const index = state.completedTasks.indexOf(taskId);
        
        if (status === 'completed') {
          if (index === -1) {
            state.completedTasks.push(taskId);
          }
        } else {
          if (index > -1) {
            state.completedTasks.splice(index, 1);
          }
        }
        
        // Update task status in tasks array
        const task = state.tasks.find(t => t.taskId === taskId);
        if (task) {
          task.status = status;
        }
      })
      .addCase(updateTaskStatus.rejected, (state, action) => {
        // Revert optimistic update on error
        state.error = action.payload;
      });
  }
});

export const { setCompletedTasks, toggleTaskStatusLocal, clearTasks } = TasksSlice.actions;
export default TasksSlice.reducer;

